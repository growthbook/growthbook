// Must load before anything imports shared/experiments; see scenarios.test.ts.
import "shared/enterprise";
import { runSuite } from "./harness/suite";
import { closeWorldDb, openWorldDb } from "./harness/world";
import { makeChangesSuite } from "./scenarios/make-changes";

beforeAll(openWorldDb, 60000);
afterAll(closeWorldDb);

it("Make Changes suite reaches its pass-rate threshold", async () => {
  const summary = await runSuite(makeChangesSuite);
  expect(summary.passed).toBe(true);
});
