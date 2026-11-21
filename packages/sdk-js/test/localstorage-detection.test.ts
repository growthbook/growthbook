/**
 * @jest-environment node
 */

const globals = globalThis as unknown as Record<string, unknown>;

async function loadPolyfills() {
  let localStorage: unknown;
  await jest.isolateModulesAsync(async () => {
    await import("../src/feature-repository");
    const { getPolyfills } = await import("../src/util");
    localStorage = getPolyfills().localStorage;
  });
  return localStorage;
}

describe("localStorage auto-detection", () => {
  afterEach(() => {
    delete globals.localStorage;
    delete globals.window;
    delete globals.document;
  });

  it("does not read the global localStorage outside the browser", async () => {
    const getter = jest.fn(() => undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: getter,
    });

    await loadPolyfills();

    expect(getter).not.toHaveBeenCalled();
  });

  it("uses the global localStorage in the browser", async () => {
    const storage = { getItem: jest.fn(), setItem: jest.fn() };
    globals.window = {};
    globals.document = {};
    globals.localStorage = storage;

    expect(await loadPolyfills()).toBe(storage);
  });
});
