// Stand-in for heavy packages no test exercises. Callable, constructible, and
// every property yields another stub, so any usage shape resolves.
const handler = {
  get: (target, prop) => {
    // Symbols stay undefined so coercion behaves like a plain object, and a
    // stub must not look thenable or `await` would resolve to the wrong value.
    if (typeof prop === "symbol" || prop === "then") return undefined;
    if (prop === "__esModule") return true;
    if (!(prop in target)) target[prop] = makeStub();
    return target[prop];
  },
  apply: () => makeStub(),
  construct: () => makeStub(),
};

function makeStub() {
  return new Proxy(function stub() {}, handler);
}

module.exports = makeStub();
