import { menuKey } from './planner-model.mjs';

export class PlannerController {
  constructor({ model, service, onChange = () => {} }) {
    this.model = model;
    this.service = service;
    this.onChange = onChange;
    this.queue = [];
    this.running = null;
    this.activeWeek = null;
    this.saveJobs = new Map();
    this.saveAgain = new Set();
    this.message = '';
    this.sequence = 0;
  }

  changed(message) { if (message) this.message = message; this.onChange(); }

  enqueue(task) {
    const promise = new Promise(resolve => this.queue.push({ ...task, sequence: this.sequence++, resolve }));
    queueMicrotask(() => this.pump());
    return promise;
  }

  async pump() {
    if (this.running || !this.queue.length) return;
    const priority = task => task.kind === 'save' ? 0 : task.restaurantId === this.model.activeId ? 1 : 2;
    this.queue.sort((a, b) => priority(a) - priority(b) || a.sequence - b.sequence);
    const task = this.queue.shift();
    this.running = task;
    try { await task.run(); } finally {
      this.running = null;
      task.resolve();
      this.changed();
      this.pump();
    }
  }

  showWeek(week) {
    this.activeWeek = week;
    this.cancelReads(task => task.week !== week);
    for (const id of [this.model.activeId, ...this.model.selectedIds.filter(id => id !== this.model.activeId)]) {
      if (id) this.load(id, week);
    }
    this.changed();
  }

  cancelReads(matches) {
    const obsolete = this.queue.filter(task => task.kind === 'read' && matches(task));
    this.queue = this.queue.filter(task => !obsolete.includes(task));
    for (const task of obsolete) {
      this.model.loads.delete(menuKey(task.restaurantId, task.week));
      task.resolve();
    }
  }

  load(restaurantId, week, retry = false) {
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
        if (Number.isSafeInteger(menu.balanceRials)) this.model.balanceRials = menu.balanceRials;
        this.model.loads.set(key, { restaurantId, week, state: 'ready' });
      } catch (error) {
        this.model.loads.set(key, { restaurantId, week, state: 'error', message: error.message, code: error.code });
      }
      this.changed();
    } });
  }

  select(restaurantId) {
    if (!this.model.selectedIds.includes(restaurantId) || restaurantId === this.model.activeId) return;
    const previous = this.model.activeId;
    if (previous && this.model.changes(previous).length) this.submit(previous);
    this.model.activeId = restaurantId;
    if (this.activeWeek) this.load(restaurantId, this.activeWeek);
    this.changed();
  }

  add(restaurantId) {
    if (!this.model.restaurants.has(restaurantId)) return;
    if (!this.model.selectedIds.includes(restaurantId)) this.model.selectedIds.push(restaurantId);
    this.select(restaurantId);
    if (this.activeWeek) this.load(restaurantId, this.activeWeek);
    this.changed();
  }

  remove(restaurantId) {
    if (this.model.selectedIds.length === 1) return false;
    if (this.model.changes(restaurantId).length || this.saveJobs.has(restaurantId)) {
      this.changed('Submit or undo this restaurant’s changes before removing it.');
      return false;
    }
    this.model.selectedIds = this.model.selectedIds.filter(id => id !== restaurantId);
    this.cancelReads(task => task.restaurantId === restaurantId);
    if (this.model.activeId === restaurantId) this.model.activeId = this.model.selectedIds[0];
    this.changed();
    return true;
  }

  choose(choice) {
    try { this.model.choose(choice); this.changed(); return true; }
    catch (error) { this.changed(error.message); return false; }
  }

  removeChoice(choice) {
    try { this.model.setDesired(choice, false); this.changed(); }
    catch (error) { this.changed(error.message); }
  }

  submit(restaurantId = this.model.activeId) {
    if (this.service.mode === 'live' && !this.service.writable) {
      this.changed(this.service.writeReason || 'Dining is connected in read-only mode.');
      return Promise.resolve();
    }
    if (this.saveJobs.has(restaurantId)) { this.saveAgain.add(restaurantId); return this.saveJobs.get(restaurantId); }
    if (!this.model.changes(restaurantId).length) return Promise.resolve();
    const issue = this.model.issueFor(restaurantId);
    if (issue) {
      this.model.saves.set(restaurantId, { state: 'error', message: issue });
      this.changed(issue);
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
            const applied = batch.filter(change => result.appliedIds.includes(change.choice.id));
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
          this.model.release(changes.filter(change => this.model.inflight.has(change.choice.id)));
          this.model.saves.set(restaurantId, { state: 'error', message: error.message, code: error.code });
          this.saveAgain.delete(restaurantId);
          this.changed(`${error.message}${completed ? ` ${completed} earlier changes were saved.` : ''}`);
          return;
        }
      }
      this.model.saves.set(restaurantId, { state: 'saved' });
      this.changed(`${this.model.restaurants.get(restaurantId).shortName}: ${completed} ${completed === 1 ? 'change' : 'changes'} ${this.service.mode === 'live' ? 'verified with dining' : 'saved in the demo'}.`);
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

  retry(restaurantId) {
    if (this.model.changes(restaurantId).length) this.submit(restaurantId);
    if (this.activeWeek) this.load(restaurantId, this.activeWeek, true);
  }

  async idle() {
    while (this.running || this.queue.length || this.saveJobs.size) await new Promise(resolve => setTimeout(resolve, 0));
  }
}
