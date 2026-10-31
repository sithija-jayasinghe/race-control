import type { LiveMessage } from '@race-control/shared';

type Listener = (message: LiveMessage) => void;

/**
 * Passes live messages to everyone watching a team, inside this server process.
 * Each team is its own channel, so a message can only ever reach that team's listeners.
 * With more than one server instance this would move to Postgres LISTEN/NOTIFY (SPEC section 4).
 */
export class TeamBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Starts listening to one team. Returns a function that stops. */
  subscribe(teamId: string, listener: Listener): () => void {
    let set = this.listeners.get(teamId);
    if (!set) {
      set = new Set();
      this.listeners.set(teamId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(teamId);
    };
  }

  publish(teamId: string, message: LiveMessage) {
    for (const listener of this.listeners.get(teamId) ?? []) {
      try {
        listener(message);
      } catch {
        // One broken connection must not stop the others from getting the message.
      }
    }
  }

  /** How many listeners a team has. For tests and diagnostics. */
  listenerCount(teamId: string): number {
    return this.listeners.get(teamId)?.size ?? 0;
  }
}
