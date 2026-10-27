import { errorDetails, ProbeError } from './transport.ts';

export type ConnectionPhase = 'checking' | 'waiting' | 'connected' | 'read-only' | 'redirect' | 'login' | 'network' | 'timeout' | 'server' | 'permission' | 'error';
export interface ConnectionState {
  phase: ConnectionPhase;
  message: string;
  code?: string;
  checkedAt: number | null;
}

export function connectionFailure(error: unknown): Pick<ConnectionState, 'phase' | 'message' | 'code'> {
  const { code, message } = errorDetails(error);
  const phase = code === 'redirect-required' ? 'redirect'
    : code === 'login-required' ? 'login'
      : code === 'permission-required' ? 'permission'
        : code === 'network-error' ? 'network' : code === 'timeout' ? 'timeout' : code === 'server-error' ? 'server' : 'error';
  return { phase, code, message };
}

// Owns retry deduplication and one return-to-tab check per explicit dining visit.
// It never polls, follows login redirects, or submits reservations.
export class ConnectionController {
  state: ConnectionState = { phase: 'checking', message: '', checkedAt: null };
  pending: Promise<void> | null = null;
  opening = false;
  awaitingReturn = false;

  constructor(private actions: {
    connect(interactive: boolean): Promise<{ writable: boolean; writeReason: string }>;
    openDining(): Promise<unknown>;
    changed(): void;
    onError?(failure: { message: string; code?: string }): void;
  }) {}

  check(interactive = false): Promise<void> {
    if (this.pending) return this.pending;
    this.awaitingReturn = false;
    this.state = { ...this.state, phase: 'checking', message: '', code: undefined };
    // Install the pending promise before calling the async action or notifying the UI.
    this.pending = Promise.resolve().then(() => this.actions.connect(interactive)).then(result => {
      this.state = { phase: result.writable ? 'connected' : 'read-only', message: result.writeReason, checkedAt: Date.now() };
    }, error => {
      this.state = { ...connectionFailure(error), checkedAt: Date.now() };
      this.actions.onError?.({ message: this.state.message, code: this.state.code });
    }).finally(() => { this.pending = null; this.actions.changed(); });
    this.actions.changed();
    return this.pending;
  }

  async openDining() {
    if (this.opening || this.pending) return;
    this.opening = true;
    this.awaitingReturn = true;
    this.state = { ...this.state, phase: 'waiting', message: '', code: undefined };
    this.actions.changed();
    try { await this.actions.openDining(); }
    catch {
      this.awaitingReturn = false;
      this.state = { ...this.state, phase: 'error', message: 'The dining tab could not be opened. Try opening it again.' };
      this.actions.onError?.({ message: this.state.message });
    } finally { this.opening = false; this.actions.changed(); }
  }

  returned() {
    if (!this.awaitingReturn) return;
    this.awaitingReturn = false; // Focus and visibility events may arrive together.
    return this.check();
  }

  invalidate(code: string | undefined, message: string) {
    if (!['connected', 'read-only'].includes(this.state.phase)) return;
    this.state = { ...this.state, ...connectionFailure(new ProbeError(code ?? 'unexpected-error', message)) };
    this.actions.changed();
  }

  verified(result: { writable: boolean; writeReason: string }) {
    if (this.pending || this.opening) return;
    this.state = { phase: result.writable ? 'connected' : 'read-only', message: result.writeReason, checkedAt: Date.now() };
    this.actions.changed();
  }
}
