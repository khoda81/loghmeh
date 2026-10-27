import { ProbeError, type RequestParameters } from './transport.ts';
import type { CapturedChange, Menu, PlannerService, Restaurant, RuntimeApi, SaveResult } from './types.ts';

export interface Connection {
  token: string;
  restaurants: Restaurant[];
  balanceRials: number;
  writable: boolean;
  writeReason: string;
  accountTag: string | null;
  walletName: string;
  fixture?: boolean;
}
export interface LiveSaveResult extends SaveResult { menu: Menu; appliedIds: string[]; attempted: boolean; complete: boolean; message: string }
interface Check { operation: string; result: string; elapsedMs?: number; [detail: string]: unknown }

export class LiveDiningService implements PlannerService {
  api: RuntimeApi<'sendMessage' | 'getManifest'>;
  mode = 'live';
  token: string | null = null;
  writable = false;
  writeReason = '';
  accountTag: string | null = null;
  restaurants: Restaurant[] = [];
  balanceRials = 0;
  fixture?: boolean;
  checks: Check[] = [];
  recovery: Promise<void> | null = null;
  sessionVerified = false;
  sessionCheckedAt: number | null = null;

  constructor(api: RuntimeApi<'sendMessage' | 'getManifest'>) {
    this.api = api;
  }

  request(operation: 'connect', parameters?: RequestParameters, recovered?: boolean): Promise<Connection>;
  request(operation: 'menu', parameters: RequestParameters, recovered?: boolean): Promise<Menu>;
  request(operation: 'save', parameters: RequestParameters, recovered?: boolean): Promise<LiveSaveResult>;
  async request(operation: string, parameters: RequestParameters = {}, recovered = false): Promise<any> {
    const started = performance.now();
    const check: Check = { operation, result: 'pending' };
    this.checks.push(check);
    if (this.checks.length > 80) this.checks.shift();
    try {
      let result;
      try { result = await this.api.runtime.sendMessage({ type: 'loghmeh:planner', operation, parameters }); }
      catch {
        // A missing reply does not establish whether the background already wrote.
        throw new ProbeError(operation === 'save' ? 'save-unknown' : 'background-unavailable', operation === 'save'
          ? 'Dining may have saved these changes, but the extension lost the reply. Check save status before submitting again.'
          : 'The planner could not reach the extension background. Reconnect dining; if it still fails, reload the extension and open a new planner tab.');
      }
      if (!result) throw new ProbeError(operation === 'save' ? 'save-unknown' : 'background-unavailable', operation === 'save'
        ? 'Dining may have saved these changes, but no confirmation arrived. Check save status before submitting again.'
        : 'The extension did not reply. Reconnect dining; if it still fails, reload the extension and open a new planner tab.');
      if (!result.ok && result.error.code === 'reconnect-required' && !recovered
          && this.token && ['menu', 'save'].includes(operation)) {
        // This error comes only from the background context lookup, before HTTP.
        // Recover a suspended/reloaded background without retrying a transmitted write.
        await this.recoverContext(String(parameters.restaurantId));
        check.result = 'reconnected';
        return await this.request(operation as 'menu', { ...parameters, token: this.token }, true);
      }
      if (!result.ok) throw new ProbeError(result.error.code, result.error.message, result.error.diagnostic);
      check.result = 'passed';
      if (operation === 'connect') Object.assign(check, { restaurantCount: result.value.restaurants.length, writable: result.value.writable });
      if (operation === 'menu') Object.assign(check, { week: result.value.week, foodCount: result.value.choices.length,
        reservedCount: result.value.reservedIds.length, lockedCount: result.value.choices.filter((choice: { locked: boolean }) => choice.locked).length });
      if (operation === 'save') Object.assign(check, { result: result.value.complete ? 'verified' : 'not-accepted', attempted: result.value.attempted, appliedCount: result.value.appliedIds.length });
      return result.value;
    } catch (error) {
      check.result = error instanceof ProbeError ? error.code : 'extension-error';
      if (error instanceof ProbeError) {
        const { operation: requestOperation, path, method, status } = error.diagnostic;
        // Report only fixed endpoint names and HTTP metadata, never redirect URLs or response bodies.
        if (typeof path === 'string' && /^\/Reserves(?:\/(?:GetRestaurantByPersonGroup|GetReservePage|GetCurrentReservePage|GetNextReservePage|GetPreReservePage|Index))?$/u.test(path)) check.path = path;
        if (['bootstrap', 'restaurants', 'menu', 'current', 'next', 'previous', 'submit'].includes(requestOperation ?? '')) check.requestOperation = requestOperation;
        if (method === 'GET' || method === 'POST') check.method = method;
        if (typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 599) check.status = status;
        if (['login-required', 'redirect-required', 'reconnect-required', 'account-changed', 'background-unavailable'].includes(error.code)) {
          this.sessionVerified = false;
          this.writable = false;
          this.writeReason = error.message;
        }
      }
      throw error;
    } finally { check.elapsedMs = Math.round(performance.now() - started); }
  }

  async connect() {
    this.sessionVerified = false;
    this.writable = false;
    try {
      const result = await this.request('connect');
      if (this.accountTag != null && result.accountTag !== this.accountTag) {
        throw new ProbeError('account-changed', 'The signed-in account changed. Open a new Loghmeh tab; your old drafts stay here.');
      }
      Object.assign(this, result);
      this.sessionVerified = true;
      return result;
    } finally { this.sessionCheckedAt = Date.now(); }
  }

  async recoverContext(restaurantId: string) {
    if (!this.recovery) {
      this.sessionVerified = false;
      this.writable = false;
      this.recovery = (async () => {
        const connection = await this.request('connect', {}, true);
        if (connection.accountTag !== this.accountTag) {
          this.writable = false;
          throw new ProbeError('account-changed', 'The signed-in account changed. Open a new Loghmeh tab; your old drafts stay here.');
        }
        Object.assign(this, connection);
        this.sessionVerified = true;
      })().finally(() => { this.sessionCheckedAt = Date.now(); this.recovery = null; });
    }
    await this.recovery;
    if (!this.restaurants.some(restaurant => restaurant.id === restaurantId)) {
      throw new ProbeError('reconnect-required', 'This restaurant is no longer eligible. Reconnect to choose another place.');
    }
  }

  connectionReport() {
    return { app: 'Loghmeh', version: this.api.runtime.getManifest?.().version || 'test', environment: this.fixture ? 'fixture' : 'extension',
      sessionVerified: !this.fixture && this.sessionVerified, sessionCheckedAt: this.sessionCheckedAt,
      menuVerified: !this.fixture && this.checks.some(check => check.operation === 'menu' && check.result === 'passed'),
      writeVerified: !this.fixture && this.checks.some(check => check.operation === 'save' && check.attempted && check.result === 'verified'), checks: this.checks };
  }

  readMenu(restaurantId: string, week: string) { return this.request('menu', { token: this.token, restaurantId, week }); }

  async save(restaurantId: string, week: string, changes: CapturedChange[]) {
    try {
      return await this.request('save', { token: this.token, restaurantId, week,
        changes: changes.map(({ choice, desired, expectedReserved, expectedPriceRials, expectedPreviousCount }) => ({ id: choice.id, desired,
          expectedReserved, expectedPriceRials, expectedPreviousCount })) });
    } catch (error) {
      if (!(error instanceof ProbeError) || error.code !== 'save-unknown') throw error;
      // One read-only recovery attempt. Never resend a write whose reply was lost.
      return this.reconcile(restaurantId, week, changes);
    }
  }

  async reconcile(restaurantId: string, week: string, changes: CapturedChange[]): Promise<LiveSaveResult> {
    try {
      await this.recoverContext(restaurantId); // Verify the same account before adopting any state.
      const menu = await this.readMenu(restaurantId, week);
      if (menu.restaurantId !== restaurantId || menu.week !== week || !Number.isSafeInteger(menu.balanceRials) || menu.balanceRials! < 0
          || changes.some(change => !menu.choices.some(choice => choice.id === change.choice.id))) {
        throw new ProbeError('unexpected-response', 'Dining did not return the complete requested menu and balance.');
      }
      const appliedIds = changes.filter(change => menu.reservedIds.includes(change.choice.id) === change.desired).map(change => change.choice.id);
      const complete = appliedIds.length === changes.length;
      // Report reconciliation separately: a successful read is not evidence of another POST.
      this.checks.push({ operation: 'reconcile', result: complete ? 'verified' : 'not-applied', appliedCount: appliedIds.length });
      return { menu, balanceRials: menu.balanceRials!, appliedIds, attempted: false, complete,
        message: complete ? 'Saved reservations verified with dining. Nothing was resubmitted.'
          : 'Not all requested changes appear in dining’s current reservations. Nothing was resubmitted.' };
    } catch (error) {
      const reason = error instanceof ProbeError ? error.message : 'The extension could not read back the reservations.';
      throw new ProbeError('save-unknown', `Dining may have saved these changes, but their status could not be verified. ${reason}`);
    }
  }
}
