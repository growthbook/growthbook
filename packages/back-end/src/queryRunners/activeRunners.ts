// Structural, so QueryRunner can import this module without a cycle.
type ActiveRunner = { model: { id: string } };

const activeRunners = new Set<ActiveRunner>();
let idleWaiters: (() => void)[] = [];

export function trackActiveRunner(runner: ActiveRunner): void {
  activeRunners.add(runner);
}

export function untrackActiveRunner(runner: ActiveRunner): void {
  if (!activeRunners.delete(runner) || activeRunners.size > 0) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  waiters.forEach((resolve) => resolve());
}

export function getActiveRunnerIds(): string[] {
  return [...activeRunners].map((runner) => runner.model.id);
}

export function waitForActiveRunners(): Promise<void> {
  if (activeRunners.size === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
