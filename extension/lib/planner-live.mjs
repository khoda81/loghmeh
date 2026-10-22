import { ProbeError } from './transport.mjs';

export class LiveDiningService {
  constructor(api) {
    this.api = api;
    this.mode = 'live';
    this.token = null;
    this.writable = false;
    this.checks = [];
    this.recovery = null;
  }

  async request(operation, parameters = {}, recovered = false) {
    const started = performance.now();
    const check = { operation, result: 'pending' };
    this.checks.push(check);
    if (this.checks.length > 80) this.checks.shift();
    try {
      const result = await this.api.runtime.sendMessage({ type: 'loghmeh:planner', operation, parameters });
      if (!result) throw new ProbeError('extension-error', 'Reload Loghmeh in about:debugging, then reconnect.');
      if (!result.ok && result.error.code === 'reconnect-required' && !recovered
          && this.token && ['menu', 'save'].includes(operation)) {
        // This error comes only from the background context lookup, before HTTP.
        // Recover a suspended/reloaded background without retrying a transmitted write.
        await this.recoverContext(parameters.restaurantId);
        check.result = 'reconnected';
        return await this.request(operation, { ...parameters, token: this.token }, true);
      }
      if (!result.ok) throw new ProbeError(result.error.code, result.error.message);
      check.result = 'passed';
      if (operation === 'connect') Object.assign(check, { restaurantCount: result.value.restaurants.length, writable: result.value.writable });
      if (operation === 'menu') Object.assign(check, { week: result.value.week, foodCount: result.value.choices.length,
        reservedCount: result.value.reservedIds.length, lockedCount: result.value.choices.filter(choice => choice.locked).length });
      if (operation === 'save') Object.assign(check, { result: result.value.complete ? 'verified' : 'not-accepted', attempted: result.value.attempted, appliedCount: result.value.appliedIds.length });
      return result.value;
    } catch (error) {
      check.result = error instanceof ProbeError ? error.code : 'extension-error';
      throw error;
    } finally { check.elapsedMs = Math.round(performance.now() - started); }
  }

  async connect() {
    const result = await this.request('connect');
    Object.assign(this, result);
    return result;
  }

  async recoverContext(restaurantId) {
    if (!this.recovery) {
      this.recovery = (async () => {
        const connection = await this.request('connect', {}, true);
        if (connection.accountTag !== this.accountTag) {
          this.writable = false;
          throw new ProbeError('account-changed', 'The signed-in account changed. Open a new Loghmeh tab; your old drafts stay here.');
        }
        Object.assign(this, connection);
      })().finally(() => { this.recovery = null; });
    }
    await this.recovery;
    if (!this.restaurants.some(restaurant => restaurant.id === restaurantId)) {
      throw new ProbeError('reconnect-required', 'This restaurant is no longer eligible. Reconnect to choose another place.');
    }
  }

  connectionReport() {
    return { app: 'Loghmeh', version: this.api.runtime.getManifest?.().version || 'test', environment: this.fixture ? 'fixture' : 'extension',
      sessionVerified: !this.fixture && Boolean(this.token), menuVerified: !this.fixture && this.checks.some(check => check.operation === 'menu' && check.result === 'passed'),
      writeVerified: !this.fixture && this.checks.some(check => check.operation === 'save' && check.attempted && check.result === 'verified'), checks: this.checks };
  }

  readMenu(restaurantId, week) { return this.request('menu', { token: this.token, restaurantId, week }); }

  save(restaurantId, week, changes) {
    return this.request('save', { token: this.token, restaurantId, week,
      changes: changes.map(({ choice, desired, expectedReserved, expectedPriceRials, expectedPreviousCount }) => ({ id: choice.id, desired,
        expectedReserved, expectedPriceRials, expectedPreviousCount })) });
  }
}
