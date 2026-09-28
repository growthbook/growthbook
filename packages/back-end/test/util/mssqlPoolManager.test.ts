import { EventEmitter } from "events";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import {
  closeMssqlPool,
  findOrCreateConnection,
} from "back-end/src/util/mssqlPoolManager";

type MockPool = EventEmitter & { closeCalls: number };

const created: MockPool[] = [];
let connectBehavior: () => Promise<void> = async () => undefined;

jest.mock("mssql", () => {
  class ConnectionPool extends EventEmitter {
    closeCalls = 0;
    constructor() {
      super();
      created.push(this);
    }
    connect() {
      return connectBehavior().then(() => this);
    }
    async close() {
      this.closeCalls++;
    }
  }
  return { __esModule: true, default: { ConnectionPool } };
});

const config: MssqlConnectionParams = {
  server: "db.example.com",
  port: 1433,
  user: "gb",
  password: "secret",
  database: "analytics",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  created.length = 0;
  connectBehavior = async () => undefined;
});

describe("findOrCreateConnection", () => {
  it("reuses the pool while the config is unchanged", async () => {
    const first = await findOrCreateConnection("ds-reuse", config);
    const second = await findOrCreateConnection("ds-reuse", { ...config });
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("replaces and closes the pool when the config changes", async () => {
    const stale = await findOrCreateConnection("ds-rotate", config);
    const fresh = await findOrCreateConnection("ds-rotate", {
      ...config,
      password: "rotated",
    });
    await flush();
    expect(fresh).not.toBe(stale);
    expect(created).toHaveLength(2);
    expect(created[0].closeCalls).toBe(1);
    expect(created[1].closeCalls).toBe(0);
  });

  it("evicts a rejected connect so the next call retries", async () => {
    connectBehavior = async () => {
      throw new Error("login failed");
    };
    await expect(findOrCreateConnection("ds-retry", config)).rejects.toThrow(
      "login failed",
    );

    connectBehavior = async () => undefined;
    const pool = await findOrCreateConnection("ds-retry", config);
    expect(created).toHaveLength(2);
    expect(pool).toBe(created[1]);
  });

  it("does not let a slow rejection evict a newer replacement pool", async () => {
    let rejectSlow: (e: Error) => void = () => undefined;
    connectBehavior = () =>
      new Promise((_, reject) => {
        rejectSlow = reject;
      });
    const slow = findOrCreateConnection("ds-race", config);

    connectBehavior = async () => undefined;
    const replacement = await findOrCreateConnection("ds-race", {
      ...config,
      password: "rotated",
    });

    rejectSlow(new Error("too late"));
    await expect(slow).rejects.toThrow("too late");

    const again = await findOrCreateConnection("ds-race", {
      ...config,
      password: "rotated",
    });
    expect(again).toBe(replacement);
    expect(created).toHaveLength(2);
  });

  it("attaches an error listener so pool errors do not throw", async () => {
    const pool = await findOrCreateConnection("ds-error", config);
    expect(() => pool.emit("error", new Error("tedious"))).not.toThrow();
  });
});

describe("closeMssqlPool", () => {
  it("closes and forgets the pool, and is a no-op afterwards", async () => {
    await findOrCreateConnection("ds-close", config);
    await closeMssqlPool("ds-close");
    expect(created[0].closeCalls).toBe(1);

    await closeMssqlPool("ds-close");
    expect(created[0].closeCalls).toBe(1);

    await findOrCreateConnection("ds-close", config);
    expect(created).toHaveLength(2);
  });

  it("waits for a pending connect before closing", async () => {
    let finishConnect: () => void = () => undefined;
    connectBehavior = () =>
      new Promise((resolve) => {
        finishConnect = resolve;
      });
    const connecting = findOrCreateConnection("ds-pending", config);
    const closing = closeMssqlPool("ds-pending");
    await flush();
    expect(created[0].closeCalls).toBe(0);

    finishConnect();
    await connecting;
    await closing;
    expect(created[0].closeCalls).toBe(1);
  });
});
