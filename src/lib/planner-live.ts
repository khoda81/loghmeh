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
      const result = await this.api.runtime.sendMessage({ type: 'loghmeh:planner', operation, parameters });
      if (!result) throw new ProbeError('extension-error', 'Reload Loghmeh in about:debugging, then reconnect.');
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
        if (['login-required', 'redirect-required', 'reconnect-required', 'account-changed'].includes(error.code)) {
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
      Object.assign(this, result);
      this.sessionVerified = true;
      return result;
    } finally { this.sessionCheckedAt = Date.now(); }
  }

  async recoverContext(restaurantId: string) {
    if (!this.recovery) {
      this.recovery = (async () => {
        const connection = await this.request('connect', {}, true);
        if (connection.accountTag !== this.accountTag) {
          this.writable = false;
          throw new ProbeError('account-changed', 'The signed-in account changed. Open a new Loghmeh tab; your old drafts stay here.');
        }
        Object.assign(this, connection);
        this.sessionVerified = true;
        this.sessionCheckedAt = Date.now();
      })().finally(() => { this.recovery = null; });
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

  save(restaurantId: string, week: string, changes: CapturedChange[]) {
    return this.request('save', { token: this.token, restaurantId, week,
      changes: changes.map(({ choice, desired, expectedReserved, expectedPriceRials, expectedPreviousCount }) => ({ id: choice.id, desired,
        expectedReserved, expectedPriceRials, expectedPreviousCount })) });
  }
}
