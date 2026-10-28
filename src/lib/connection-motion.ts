import type { ConnectionPhase } from './connection-state.ts';

export type ConnectionMotionState = 'checking' | 'open' | 'connected' | 'failed';

// The drawing describes the current session check; it never advances connection state.
export function connectionMotionState(phase: ConnectionPhase): ConnectionMotionState {
  switch (phase) {
    case 'checking': return 'checking';
    case 'waiting': case 'redirect': case 'login': case 'permission': return 'open';
    case 'connected': case 'read-only': return 'connected';
    case 'network': case 'timeout': case 'server': case 'error': return 'failed';
  }
}
