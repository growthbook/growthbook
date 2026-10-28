import type { Request, Response } from "express";
import {
  countMongoCalls,
  getMongoCallSummary,
  installMongoCallCounter,
  MongoCallStats,
  wrapServerCommand,
} from "back-end/src/util/mongoCallStats";

describe("MongoCallStats", () => {
  it("reports zeros when nothing ran", () => {
    expect(new MongoCallStats().summary(100)).toEqual({
      calls: 0,
      sequential: 0,
      wallMs: 0,
    });
  });

  it("chains commands that start after the previous one ended", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 10);
    stats.end(stats.start(15), 20);
    stats.end(stats.start(20), 25);
    expect(stats.summary(30)).toEqual({
      calls: 3,
      sequential: 3,
      wallMs: 20,
    });
  });

  it("does not chain or double count overlapping commands", () => {
    const stats = new MongoCallStats();
    const a = stats.start(0);
    const b = stats.start(2);
    const c = stats.start(4);
    stats.end(b, 6);
    stats.end(a, 8);
    stats.end(c, 10);
    expect(stats.summary(10)).toEqual({
      calls: 3,
      sequential: 1,
      wallMs: 10,
    });
  });

  it("takes the longest chain across parallel branches", () => {
    const stats = new MongoCallStats();
    const slow = stats.start(0);
    stats.end(stats.start(0), 1);
    const second = stats.start(2);
    stats.end(second, 3);
    const third = stats.start(4);
    stats.end(slow, 5);
    stats.end(third, 6);
    // Starts after slow (chain 1) and third (chain 3) ended
    stats.end(stats.start(7), 8);
    expect(stats.summary(8)).toEqual({
      calls: 5,
      sequential: 4,
      wallMs: 7,
    });
  });

  it("only counts time with a command outstanding", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 1.234);
    stats.end(stats.start(100), 101.12);
    expect(stats.summary(200).wallMs).toBe(2.35);
  });

  it("includes commands still outstanding at summary time", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 5);
    stats.start(10);
    expect(stats.summary(13)).toEqual({
      calls: 2,
      sequential: 2,
      wallMs: 8,
    });
  });
});

type Callback = (...args: unknown[]) => void;

function fakeServer(
  impl: (callback: Callback) => unknown = (callback) => callback(null, "ok"),
) {
  return {
    command(ns: unknown, cmd: unknown, options: unknown, callback?: Callback) {
      if (!callback) throw new Error("Callback must be provided");
      return impl(callback);
    },
  };
}

function inRequest(fn: () => void) {
  const req = {} as Request;
  countMongoCalls(req, {} as Response, fn);
  return () => getMongoCallSummary(req);
}

describe("wrapServerCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("counts calls made inside a request", () => {
    const server = fakeServer();
    expect(wrapServerCommand(server, "4.17.2")).toBe(true);
    const callback = jest.fn();
    const summary = inRequest(() => {
      server.command("ns", {}, {}, callback);
      server.command("ns", {}, {}, callback);
    });
    expect(callback).toHaveBeenNthCalledWith(1, null, "ok");
    expect(summary()).toMatchObject({ calls: 2, sequential: 2 });
  });

  it("is a no-op when wrapped twice", () => {
    const server = fakeServer();
    wrapServerCommand(server, "4.17.2");
    const once = server.command;
    expect(wrapServerCommand(server, "4.17.2")).toBe(true);
    expect(server.command).toBe(once);
  });

  it("leaves the 6.x async command alone", () => {
    // mongodb 6.10: async command(ns, cmd, options, responseType)
    class Server {
      async command(
        ns: unknown,
        cmd: unknown,
        options: unknown,
        responseType: unknown,
      ) {
        return [ns, cmd, options, responseType];
      }
    }
    const original = Server.prototype.command;
    expect(original.length).toBe(4);
    expect(wrapServerCommand(Server.prototype, "4.17.2")).toBe(false);
    expect(wrapServerCommand(Server.prototype, "6.10.0")).toBe(false);
    expect(Server.prototype.command).toBe(original);
  });

  it("only wraps a 4.x driver", () => {
    const server = fakeServer();
    const original = server.command;
    expect(wrapServerCommand(server, "6.10.0")).toBe(false);
    expect(wrapServerCommand(server, "5.9.2")).toBe(false);
    expect(wrapServerCommand(server, "")).toBe(false);
    expect(server.command).toBe(original);
  });

  it("leaves a driver with another command signature alone", () => {
    const threeArgs = (ns: unknown, cmd: unknown, options: unknown) => [
      ns,
      cmd,
      options,
    ];
    const changed = { command: threeArgs };
    expect(wrapServerCommand(changed, "4.17.2")).toBe(false);
    expect(changed.command).toBe(threeArgs);

    const missing: { command?: unknown } = {};
    expect(wrapServerCommand(missing, "4.17.2")).toBe(false);
    expect(missing.command).toBeUndefined();
  });

  it("wraps the driver mongoose uses", async () => {
    await expect(installMongoCallCounter()).resolves.toEqual({
      installed: true,
      driverVersion: expect.stringMatching(/^4\./),
    });
  });

  it("passes calls outside a request straight through", () => {
    const server = fakeServer();
    wrapServerCommand(server, "4.17.2");
    const callback = jest.fn();
    server.command("ns", {}, {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "ok");
    expect(() => server.command("ns", {}, {})).toThrow(
      "Callback must be provided",
    );
  });

  it("never lets a stats failure reach the database call", () => {
    jest.spyOn(MongoCallStats.prototype, "start").mockImplementation(() => {
      throw new Error("start");
    });
    const server = fakeServer();
    wrapServerCommand(server, "4.17.2");
    const callback = jest.fn();
    inRequest(() => server.command("ns", {}, {}, callback));
    expect(callback).toHaveBeenCalledWith(null, "ok");

    jest.restoreAllMocks();
    jest.spyOn(MongoCallStats.prototype, "end").mockImplementation(() => {
      throw new Error("end");
    });
    const after = jest.fn();
    inRequest(() => server.command("ns", {}, {}, after));
    expect(after).toHaveBeenCalledWith(null, "ok");
  });

  it("rethrows driver errors and closes the call once", () => {
    const err = new Error("boom");
    const server = fakeServer((callback) => {
      callback(err);
      throw err;
    });
    wrapServerCommand(server, "4.17.2");
    const callback = jest.fn();
    const summary = inRequest(() => {
      expect(() => server.command("ns", {}, {}, callback)).toThrow(err);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(summary()).toMatchObject({ calls: 1, sequential: 1 });
  });
});
