import { createOrderedWriter } from "back-end/src/queryRunners/orderedWriter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createOrderedWriter", () => {
  it("does not start a write until the previous one settles", async () => {
    const write = createOrderedWriter();
    const first = deferred<string>();
    const second = jest.fn().mockResolvedValue("second");

    const firstResult = write(() => first.promise);
    const secondResult = write(second);
    await flush();
    expect(second).not.toHaveBeenCalled();

    first.resolve("first");
    await expect(firstResult).resolves.toBe("first");
    await expect(secondResult).resolves.toBe("second");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("lands writes in call order when an older write is slower", async () => {
    const write = createOrderedWriter();
    const landed: string[] = [];
    const slow = deferred<void>();

    const older = write(async () => {
      await slow.promise;
      landed.push("older");
    });
    const newer = write(async () => {
      landed.push("newer");
    });

    await flush();
    slow.resolve();
    await Promise.all([older, newer]);
    expect(landed).toEqual(["older", "newer"]);
  });

  it("never runs two writes at once", async () => {
    const write = createOrderedWriter();
    let active = 0;
    let maxActive = 0;
    const writes = Array.from({ length: 5 }, (_, i) =>
      write(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await flush();
        active--;
        return i;
      }),
    );

    await expect(Promise.all(writes)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBe(1);
  });

  it("rejects only the failed write and keeps running the ones after it", async () => {
    const write = createOrderedWriter();
    const error = new Error("boom");

    const failed = write(() => Promise.reject(error));
    const after = write(() => Promise.resolve("after"));

    await expect(failed).rejects.toBe(error);
    await expect(after).resolves.toBe("after");
  });

  it("keeps going after a write that throws synchronously", async () => {
    const write = createOrderedWriter();

    const failed = write(() => {
      throw new Error("sync");
    });
    const after = write(() => Promise.resolve(1));

    await expect(failed).rejects.toThrow("sync");
    await expect(after).resolves.toBe(1);
  });

  it("reads state when the write runs, not when it is queued", async () => {
    const write = createOrderedWriter();
    const gate = deferred<void>();
    let list = ["a"];
    const written: string[][] = [];

    const first = write(async () => {
      await gate.promise;
      written.push(list);
    });
    list = ["a", "b"];
    const second = write(async () => {
      written.push(list);
    });

    gate.resolve();
    await Promise.all([first, second]);
    expect(written).toEqual([
      ["a", "b"],
      ["a", "b"],
    ]);
  });

  it("keeps separate writers independent", async () => {
    const writeA = createOrderedWriter();
    const writeB = createOrderedWriter();
    const blocked = deferred<void>();
    const other = jest.fn().mockResolvedValue(undefined);

    const a = writeA(() => blocked.promise);
    await writeB(other);
    expect(other).toHaveBeenCalledTimes(1);

    blocked.resolve();
    await a;
  });

  describe("flush", () => {
    it("waits for every queued write, including ones queued while waiting", async () => {
      const write = createOrderedWriter();
      const slow = deferred<void>();
      const landed: string[] = [];
      write(async () => {
        await slow.promise;
        landed.push("first");
        write(async () => {
          landed.push("queued meanwhile");
        });
      });

      let flushed = false;
      const flushing = write.flush().then(() => (flushed = true));
      await flush();
      expect(flushed).toBe(false);

      slow.resolve();
      await flushing;
      expect(landed).toEqual(["first", "queued meanwhile"]);
    });

    it("settles when a queued write fails", async () => {
      const write = createOrderedWriter();
      write(() => Promise.reject(new Error("boom"))).catch(() => undefined);
      await expect(write.flush()).resolves.toBeUndefined();
    });

    it("settles at once with nothing queued", async () => {
      await expect(createOrderedWriter().flush()).resolves.toBeUndefined();
    });
  });
});
