/** Why a held hook request stopped waiting. The database says what was decided. */
export type WakeReason = 'woken' | 'timeout' | 'aborted';

/**
 * Held `PreToolUse` requests waiting for a lead, by approval id. In memory: a held request lives in this
 * server process, so approvals left pending by a restart are expired on startup.
 */
export class ApprovalHub {
  private readonly waiting = new Map<string, (reason: WakeReason) => void>();

  /** Waits until `wake(approvalId)`, `ms` passes, or `signal` aborts (the agent hung up). */
  wait(approvalId: string, ms: number, signal?: AbortSignal): Promise<WakeReason> {
    return new Promise((resolve) => {
      const finish = (reason: WakeReason) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiting.delete(approvalId);
        resolve(reason);
      };
      const onAbort = () => finish('aborted');
      const timer = setTimeout(() => finish('timeout'), ms);
      this.waiting.set(approvalId, finish);
      if (signal?.aborted) finish('aborted');
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  wake(approvalId: string) {
    this.waiting.get(approvalId)?.('woken');
  }

  /** How many requests are held right now. */
  get size() {
    return this.waiting.size;
  }
}
