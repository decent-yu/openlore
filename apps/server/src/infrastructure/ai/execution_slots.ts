type Waiting = {
  limit: number;
  grant: (release: () => void) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Pool = { active: number; waiting: Waiting[] };

/** All adapter instances share a profile limit, including review and research calls. */
export class ExecutionSlots {
  private pools = new Map<string, Pool>();
  acquire(
    profile: string,
    limit: number,
    timeoutSeconds: number,
  ): Promise<() => void> {
    let pool = this.pools.get(profile);
    if (!pool) {
      pool = { active: 0, waiting: [] };
      this.pools.set(profile, pool);
    }
    const selected = pool;
    return new Promise((grant, reject) => {
      const waiting: Waiting = {
        limit: Math.max(1, limit),
        grant,
        timer: setTimeout(() => {
          const index = selected.waiting.indexOf(waiting);
          if (index < 0) return;
          selected.waiting.splice(index, 1);
          reject(
            Object.assign(
              new Error(`执行器排队等待达到 ${timeoutSeconds} 秒上限`),
              { code: 'executor_queue_timeout' },
            ),
          );
          this.drain(profile, selected);
        }, timeoutSeconds * 1000),
      };
      selected.waiting.push(waiting);
      this.drain(profile, selected);
    });
  }
  private drain(profile: string, pool: Pool): void {
    while (pool.waiting.length && pool.active < pool.waiting[0].limit) {
      const next = pool.waiting.shift()!;
      clearTimeout(next.timer);
      pool.active++;
      let released = false;
      next.grant(() => {
        if (released) return;
        released = true;
        pool.active--;
        this.drain(profile, pool);
      });
    }
    if (!pool.active && !pool.waiting.length) this.pools.delete(profile);
  }
}
export const executionSlots = new ExecutionSlots();
