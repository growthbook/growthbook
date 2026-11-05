/**
 * @jest-environment node
 */

describe("localStorage detection in Node", () => {
  const originalExecArgv = process.execArgv;
  let getter: jest.Mock;

  beforeEach(() => {
    // Mimic Node 25+, where reading globalThis.localStorage without
    // --localstorage-file logs an ExperimentalWarning
    getter = jest.fn(() => undefined);
    Object.defineProperty(globalThis, "localStorage", {
      get: getter,
      configurable: true,
    });
  });

  afterEach(() => {
    process.execArgv = originalExecArgv;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("does not read localStorage without --localstorage-file", () => {
    process.execArgv = [];
    jest.isolateModules(() => {
      require("../src/feature-repository");
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("reads localStorage when --localstorage-file is provided", () => {
    process.execArgv = ["--localstorage-file=/tmp/gb.localstorage"];
    jest.isolateModules(() => {
      require("../src/feature-repository");
    });
    expect(getter).toHaveBeenCalled();
  });

  it("uses an app-supplied localStorage without --localstorage-file", async () => {
    process.execArgv = [];
    const storage = { getItem: jest.fn(), setItem: jest.fn() };
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      writable: true,
      configurable: true,
    });
    let clearCache: () => Promise<void> = async () => {};
    jest.isolateModules(() => {
      ({ clearCache } = require("../src/feature-repository"));
    });
    await clearCache();
    expect(storage.setItem).toHaveBeenCalled();
  });
});
