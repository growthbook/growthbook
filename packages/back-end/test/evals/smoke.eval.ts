// Must load before anything imports shared/experiments; see scenarios.test.ts.
import "shared/enterprise";
import { runSuite } from "./harness/suite";
import { closeWorldDb, openWorldDb } from "./harness/world";
import { smokeSuite } from "./scenarios/smoke";

beforeAll(openWorldDb, 60000);
afterAll(closeWorldDb);

it("Smoke suite reaches its pass-rate threshold", async () => {
  const summary = await runSuite(smokeSuite);
  expect(summary.passed).toBe(true);
});
