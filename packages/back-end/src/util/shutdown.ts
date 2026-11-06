/** Waits for every task up to timeoutMs; returns the names still unsettled. */
export async function drainWithDeadline(
  tasks: Record<string, Promise<unknown>>,
  timeoutMs: number,
): Promise<string[]> {
  const pending = new Set(Object.keys(tasks));
  const allSettled = Promise.allSettled(
    Object.entries(tasks).map(([name, task]) =>
      task.finally(() => pending.delete(name)),
    ),
  );

  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(resolve, timeoutMs);
  });

  await Promise.race([allSettled, deadline]);
  clearTimeout(deadlineTimer);
  return [...pending];
}
