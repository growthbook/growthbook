import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Run with: node scripts/check-preview-stack.mjs
const workflow = readFileSync(
  new URL("../.github/workflows/preview.yml", import.meta.url),
  "utf8",
);
const script = workflow.match(/ {10}script: \|\n((?:\n| {12}.+\n)+)/)?.[1];
assert.ok(script, "Stack check script must exist");

for (const action of ["opened", "reopened", "synchronize", "closed"]) {
  for (const hasChild of [false, true]) {
    let calls = 0;
    const result = await runInNewContext(`(async () => {${script}})()`, {
      context: {
        repo: { owner: "growthbook", repo: "growthbook" },
        payload: { action, pull_request: { head: { ref: "stack/middle" } } },
      },
      github: {
        rest: {
          pulls: {
            list: async (params) => {
              calls++;
              assert.deepEqual(JSON.parse(JSON.stringify(params)), {
                owner: "growthbook",
                repo: "growthbook",
                state: "open",
                base: "stack/middle",
                per_page: 1,
              });
              return { data: hasChild ? [{ number: 123 }] : [] };
            },
          },
        },
      },
    });
    assert.equal(result, action === "closed" || !hasChild);
    assert.equal(calls, action === "closed" ? 0 : 1);
  }
}
