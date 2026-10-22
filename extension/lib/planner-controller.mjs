import { menuKey } from './planner-model.mjs';

export class PlannerController {
  constructor({ model, service, onChange = () => {} }) {
    this.model = model;
    this.service = service;
    this.onChange = onChange;
    this.queue = [];
    this.running = null;
    this.visibleWeeks = new Set();
    this.backgroundWeeks = new Set();
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
    this.queue.sort((a, b) => (a.kind === 'save' ? 0 : a.restaurantId === this.model.activeId ? 1 : 2)
      - (b.kind === 'save' ? 0 : b.restaurantId === this.model.activeId ? 1 : 2) || a.sequence - b.sequence);
    const task = this.queue.shift();
    this.running = task;
    try { await task.run(); } finally {
      this.running = null;
      task.resolve();
      this.changed();
      this.pump();
    }
  }

  ensureWeek(week, background = false) {
    if (background) this.backgroundWeeks.add(week); else this.visibleWeeks.add(week);
    for (const id of [this.model.activeId, ...this.model.selectedIds.filter(id => id !== this.model.activeId)]) {
      if (id) this.load(id, week);
    }
  }

  hideWeek(week) {
    this.visibleWeeks.delete(week);
    if (this.backgroundWeeks.has(week)) return;
    const obsolete = this.queue.filter(task => task.kind === 'read' && task.week === week);
    this.queue = this.queue.filter(task => !obsolete.includes(task));
    for (const task of obsolete) {
      this.model.loads.delete(menuKey(task.restaurantId, week));
      task.resolve();
    }
    if (obsolete.length) this.changed();
  }

  load(restaurantId, week, retry = false) {
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
        this.model.loads.set(key, { restaurantId, week, state: 'ready' });
      } catch (error) {
        this.model.loads.set(key, { restaurantId, week, state: 'error', message: error.message });
      }
      this.changed();
    } });
  }

  select(restaurantId) {
    if (!this.model.selectedIds.includes(restaurantId) || restaurantId === this.model.activeId) return;
    const previous = this.model.activeId;
    if (previous && this.model.changes(previous).length) this.submit(previous);
    this.model.activeId = restaurantId;
    for (const week of new Set([...this.visibleWeeks, ...this.backgroundWeeks])) this.load(restaurantId, week);
    this.changed();
  }

  add(restaurantId) {
    if (!this.model.restaurants.has(restaurantId)) return;
    if (!this.model.selectedIds.includes(restaurantId)) this.model.selectedIds.push(restaurantId);
    this.select(restaurantId);
    for (const week of new Set([...this.visibleWeeks, ...this.backgroundWeeks])) this.load(restaurantId, week);
    this.changed();
  }

  remove(restaurantId) {
    if (this.model.selectedIds.length === 1) return false;
    if (this.model.changes(restaurantId).length || this.saveJobs.has(restaurantId)) {
      this.changed('Submit or undo this restaurant’s changes before removing it.');
      return false;
    }
    this.model.selectedIds = this.model.selectedIds.filter(id => id !== restaurantId);
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
          this.model.commit(batch, result.balanceRials);
          completed += batch.length;
          this.changed();
        } catch (error) {
          this.model.release(changes.filter(change => this.model.inflight.has(change.choice.id)));
          this.model.saves.set(restaurantId, { state: 'error', message: error.message });
          this.saveAgain.delete(restaurantId);
          this.changed(`${error.message}${completed ? ` ${completed} earlier changes were saved.` : ''}`);
          return;
        }
      }
      this.model.saves.set(restaurantId, { state: 'saved' });
      this.changed(`${this.model.restaurants.get(restaurantId).shortName}: ${completed} ${completed === 1 ? 'change' : 'changes'} saved in the demo.`);
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
    for (const load of this.model.loads.values()) if (load.restaurantId === restaurantId && load.state === 'error') this.load(restaurantId, load.week, true);
  }

  async idle() {
    while (this.running || this.queue.length || this.saveJobs.size) await new Promise(resolve => setTimeout(resolve, 0));
  }
}
