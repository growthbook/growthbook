/**
 * @jest-environment node
 */

describe("localStorage detection in Node", () => {
  const originalExecArgv = process.execArgv;
  const originalNodeOptions = process.env.NODE_OPTIONS;
  let getter: jest.Mock;

  beforeEach(() => {
    // Isolate from flags inherited by the test runner
    process.execArgv = [];
    delete process.env.NODE_OPTIONS;
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
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("does not read localStorage without --localstorage-file", () => {
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

  it("reads localStorage when --localstorage-file is in NODE_OPTIONS", () => {
    process.env.NODE_OPTIONS = "--localstorage-file=/tmp/gb.localstorage";
    jest.isolateModules(() => {
      require("../src/feature-repository");
    });
    expect(getter).toHaveBeenCalled();
  });

  it("uses an app-supplied localStorage without --localstorage-file", async () => {
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
