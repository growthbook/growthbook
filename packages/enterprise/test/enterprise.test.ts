import { getAccountPlan } from "../src";

describe("determines account plan from org", () => {
  expect(getAccountPlan({})).toBe(false);
  expect(
    getAccountPlan({
      enterprise: true,
    })
  ).toBe(true);
  expect(
    getAccountPlan({
      restrictAuthSubPrefix: "something",
    })
  ).toBe(true);
  expect(
    getAccountPlan({
      restrictLoginMethod: "something",
    })
  ).toBe(true);
  expect(
    getAccountPlan({
      subscription: {
        status: "canceled",
      },
    })
  ).toBe(false);
  expect(
    getAccountPlan({
      subscription: {
        status: "active",
      },
    })
  ).toBe(true);
  expect(
    getAccountPlan({
      subscription: {
        status: "trialing",
      },
    })
  ).toBe(true);
  expect(
    getAccountPlan({
      subscription: {
        status: "past_due",
      },
    })
  ).toBe(true);
});
