import { menuKey, type PlannerModel } from './planner-model.ts';
import { errorDetails, ProbeError } from './transport.ts';
import type { CapturedChange, Choice, PlannerService } from './types.ts';

interface Task {
  kind: 'read' | 'save' | 'verify';
  restaurantId: string;
  week?: string;
  run(): Promise<void>;
}
type QueuedTask = Task & { sequence: number; resolve(): void };

export interface PlannerFailure {
  operation: 'load' | 'save' | 'edit';
  message: string;
  code?: string;
  restaurantId?: string;
  week?: string;
}

export class PlannerController {
  model: PlannerModel;
  service: PlannerService;
  onChange: () => void;
  onError: (failure: PlannerFailure) => void;
  queue: QueuedTask[] = [];
  running: QueuedTask | null = null;
  activeWeek: string | null = null;
  saveJobs = new Map<string, Promise<void>>();
  uncertainSaves = new Map<string, CapturedChange[]>();
  saveAgain = new Set<string>();
  message = '';
  sequence = 0;

  constructor({ model, service, onChange = () => {}, onError = () => {} }: {
    model: PlannerModel; service: PlannerService; onChange?: () => void; onError?: (failure: PlannerFailure) => void;
  }) {
    this.model = model;
    this.service = service;
    this.onChange = onChange;
    this.onError = onError;
  }

  changed(message?: string) { if (message) this.message = message; this.onChange(); }

  enqueue(task: Task) {
    const promise = new Promise<void>(resolve => this.queue.push({ ...task, sequence: this.sequence++, resolve }));
    queueMicrotask(() => this.pump());
    return promise;
  }

  async pump() {
    if (this.running || !this.queue.length) return;
    const priority = (task: Task) => task.kind !== 'read' ? 0 : task.restaurantId === this.model.activeId ? 1 : 2;
    this.queue.sort((a, b) => priority(a) - priority(b) || a.sequence - b.sequence);
    const task = this.queue.shift()!;
    this.running = task;
    try { await task.run(); } finally {
      this.running = null;
      task.resolve();
      this.changed();
      this.pump();
    }
  }

  showWeek(week: string) {
    this.activeWeek = week;
    this.cancelReads(task => task.week !== week);
    for (const id of [this.model.activeId, ...this.model.selectedIds.filter(id => id !== this.model.activeId)]) {
      if (id) this.load(id, week);
    }
    this.changed();
  }

  cancelReads(matches: (task: QueuedTask) => boolean) {
    const obsolete = this.queue.filter(task => task.kind === 'read' && matches(task));
    this.queue = this.queue.filter(task => !obsolete.includes(task));
    for (const task of obsolete) {
      this.model.loads.delete(menuKey(task.restaurantId, task.week!));
      task.resolve();
    }
  }

  load(restaurantId: string, week: string, retry = false) {
    if (week !== this.activeWeek || !this.model.selectedIds.includes(restaurantId)) return;
    const key = menuKey(restaurantId, week);
    const previous = this.model.loads.get(key);
    if (previous && (!retry || previous.state !== 'error')) return;
    this.model.loads.set(key, { restaurantId, week, state: 'queued' });
    this.changed();
    return this.enqueue({ kind: 'read', restaurantId, week, run: async () => {
      this.model.loads.set(key, { restaurantId, week, state: 'loading' });
      this.changed();
      try {
        const menu = await this.service.readMenu(restaurantId, week);
        // All adapters must verify returned week dates before committing data here.
        if (menu.restaurantId !== restaurantId || menu.week !== week) throw new Error('The server returned a different week. Please retry.');
        this.model.receiveMenu(menu);
        if (typeof menu.balanceRials === 'number' && Number.isSafeInteger(menu.balanceRials)) this.model.balanceRials = menu.balanceRials;
        this.model.loads.set(key, { restaurantId, week, state: 'ready' });
      } catch (error) {
        const details = errorDetails(error);
        this.model.loads.set(key, { restaurantId, week, state: 'error', ...details });
        this.onError({ operation: 'load', restaurantId, week, ...details });
      }
      this.changed();
    } });
  }

  select(restaurantId: string, { submitPrevious = true } = {}) {
    if (!this.model.selectedIds.includes(restaurantId) || restaurantId === this.model.activeId) return;
    const previous = this.model.activeId;
    if (submitPrevious && previous && this.model.changes(previous).length) this.submit(previous);
    this.model.activeId = restaurantId;
    if (this.activeWeek) this.load(restaurantId, this.activeWeek);
    this.changed();
  }

  add(restaurantId: string, options?: { submitPrevious?: boolean }) {
    if (!this.model.restaurants.has(restaurantId)) return false;
    if (!this.model.selectedIds.includes(restaurantId)) this.model.selectedIds.push(restaurantId);
    this.select(restaurantId, options);
    if (this.activeWeek) this.load(restaurantId, this.activeWeek);
    this.changed();
    return true;
  }

  remove(restaurantId: string) {
    if (this.model.selectedIds.length === 1) return false;
    if (this.model.changes(restaurantId).length || this.saveJobs.has(restaurantId) || this.uncertainSaves.has(restaurantId)) {
      this.onError({ operation: 'edit', restaurantId, message: 'Submit or undo this restaurant’s changes before hiding it.' });
      this.changed();
      return false;
    }
    this.model.selectedIds = this.model.selectedIds.filter(id => id !== restaurantId);
    this.cancelReads(task => task.restaurantId === restaurantId);
    if (this.model.activeId === restaurantId) this.model.activeId = this.model.selectedIds[0];
    this.changed();
    return true;
  }

  choose(choice: Choice) {
    try { this.model.choose(choice); this.changed(); return true; }
    catch (error) { this.onError({ operation: 'edit', restaurantId: choice.restaurantId, ...errorDetails(error) }); this.changed(); return false; }
  }

  removeChoice(choice: Choice) {
    if (!this.model.restaurants.has(choice.restaurantId)) return false;
    try { this.model.setDesired(choice, false); }
    catch (error) { this.onError({ operation: 'edit', restaurantId: choice.restaurantId, ...errorDetails(error) }); this.changed(); return false; }
    // Removing a card is an edit, not a pill switch: keep other drafts pending.
    // Make this cancellation the Submit/Undo context without an implicit save.
    return this.add(choice.restaurantId, { submitPrevious: false });
  }

  submit(restaurantId = this.model.activeId): Promise<void> {
    // Until the previous outcome is known, Submit and pill switches only read back.
    if (this.uncertainSaves.has(restaurantId)) return this.checkSave(restaurantId);
    if (this.service.mode === 'live' && !this.service.writable) {
      this.onError({ operation: 'save', restaurantId, message: this.service.writeReason || 'Dining is connected in read-only mode.' });
      this.changed();
      return Promise.resolve();
    }
    if (this.saveJobs.has(restaurantId)) { this.saveAgain.add(restaurantId); return this.saveJobs.get(restaurantId)!; }
    if (!this.model.changes(restaurantId).length) return Promise.resolve();
    const issue = this.model.issueFor(restaurantId);
    if (issue) {
      this.model.saves.set(restaurantId, { state: 'error', message: issue });
      this.onError({ operation: 'save', restaurantId, message: issue });
      this.changed();
      return Promise.resolve();
    }
    const changes = this.model.capture(restaurantId);
    this.model.saves.set(restaurantId, { state: 'queued' });
    const job = this.enqueue({ kind: 'save', restaurantId, run: async () => {
      this.model.saves.set(restaurantId, { state: 'saving' });
      this.changed();
      const weeks = [...new Set(changes.map(change => change.choice.week))].sort();
      let completed = 0;
      for (const week of weeks) {
        const batch = changes.filter(change => change.choice.week === week);
        try {
          const result = await this.service.save(restaurantId, week, batch);
          if (result.menu) {
            const applied = batch.filter(change => result.appliedIds?.includes(change.choice.id));
            this.model.commit(applied, result.balanceRials);
            this.model.receiveMenu(result.menu);
            completed += applied.length;
            this.changed();
            if (!result.complete) throw new Error(result.message);
          } else {
            this.model.commit(batch, result.balanceRials);
            completed += batch.length;
          }
          this.changed();
        } catch (error) {
          const { message, code } = errorDetails(error);
          const unknown = code === 'save-unknown';
          // Preserve attempted intents, including reversals made during the save.
          // Later weeks were never sent and may be released normally.
          this.model.release(changes.filter(change => this.model.inflight.has(change.choice.id) && (!unknown || change.choice.week !== week)));
          if (unknown) this.uncertainSaves.set(restaurantId, batch.filter(change => this.model.inflight.has(change.choice.id)));
          this.model.saves.set(restaurantId, { state: unknown ? 'unknown' : 'error', message, code });
          this.saveAgain.delete(restaurantId);
          this.onError({ operation: 'save', restaurantId, week, code, message: `${message}${completed ? ` ${completed} earlier changes were saved.` : ''}` });
          this.changed();
          return;
        }
      }
      this.model.saves.set(restaurantId, { state: 'saved' });
      this.changed(`${this.model.restaurants.get(restaurantId)?.shortName}: ${completed} ${completed === 1 ? 'change' : 'changes'} ${this.service.mode === 'live' ? 'verified with dining' : 'saved in the demo'}.`);
    } });
    this.saveJobs.set(restaurantId, job);
    job.then(() => {
      this.saveJobs.delete(restaurantId);
      if (this.saveAgain.delete(restaurantId) && this.model.changes(restaurantId).length) this.submit(restaurantId);
      this.changed();
    });
    this.changed();
    return job;
  }

  retry(restaurantId: string) {
    if (this.uncertainSaves.has(restaurantId)) return this.checkSave(restaurantId);
    if (this.model.changes(restaurantId).length) this.submit(restaurantId);
    if (this.activeWeek) this.load(restaurantId, this.activeWeek, true);
  }

  checkSave(restaurantId: string): Promise<void> {
    if (this.saveJobs.has(restaurantId)) return this.saveJobs.get(restaurantId)!;
    const changes = this.uncertainSaves.get(restaurantId);
    if (!changes?.length) return Promise.resolve();
    const week = changes[0].choice.week;
    this.model.saves.set(restaurantId, { state: 'verifying' });
    const job = this.enqueue({ kind: 'verify', restaurantId, week, run: async () => {
      try {
        if (!this.service.reconcile) throw new ProbeError('save-unknown', 'This save needs to be checked on dining.');
        const result = await this.service.reconcile(restaurantId, week, changes);
        if (!result.menu || !result.appliedIds) throw new ProbeError('save-unknown', 'Dining did not return a verifiable reservation snapshot.');
        this.model.commit(changes.filter(change => result.appliedIds!.includes(change.choice.id)), result.balanceRials);
        this.model.receiveMenu(result.menu);
        this.model.release(changes); // Only now is it safe to compare newer intent with actual state.
        this.model.loads.set(menuKey(restaurantId, week), { restaurantId, week, state: 'ready' });
        this.uncertainSaves.delete(restaurantId);
        if (result.complete) {
          this.model.saves.set(restaurantId, { state: 'saved' });
          this.changed('Saved reservations verified with dining. Nothing was resubmitted.');
        } else {
          const message = result.message || 'Some changes are not applied in dining. Your remaining choices are kept.';
          this.model.saves.set(restaurantId, { state: 'error', message });
          this.onError({ operation: 'save', restaurantId, week, message });
          this.changed();
        }
      } catch (error) {
        const message = errorDetails(error).message;
        this.model.saves.set(restaurantId, { state: 'unknown', code: 'save-unknown', message });
        this.onError({ operation: 'save', restaurantId, week, code: 'save-unknown', message });
        this.changed();
      }
    } });
    this.saveJobs.set(restaurantId, job);
    // A verification must never trigger an automatic follow-up write.
    job.then(() => { this.saveJobs.delete(restaurantId); this.saveAgain.delete(restaurantId); this.changed(); });
    this.changed();
    return job;
  }

  async idle() {
    while (this.running || this.queue.length || this.saveJobs.size) await new Promise(resolve => setTimeout(resolve, 0));
  }
}
