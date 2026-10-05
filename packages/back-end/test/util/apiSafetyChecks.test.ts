import { apiErrorRegistry } from "shared/validators";
import {
  applySafetyCheck,
  formatList,
  NOT_ENFORCED_SUFFIX,
  takeApiNotices,
} from "back-end/src/util/apiSafetyChecks";
import { ApiError } from "back-end/src/util/errors";
import { runApiHandler } from "back-end/src/util/handler";

const req = (strictEnvironmentChecks?: boolean) => ({
  context: { org: { id: "org_1", settings: { strictEnvironmentChecks } } },
  method: "POST",
  baseUrl: "/api/v2",
  path: "/features",
});

const approval = {
  violated: true,
  message: "Enabling production on a new Feature Flag requires approval.",
  notice: "Enabling production on a new Feature Flag needs approval.",
  path: "environments",
  details: { environments: ["production"] },
};

describe("applySafetyCheck", () => {
  it("throws with the registry's status and code while the setting is on", () => {
    let error: unknown;
    try {
      applySafetyCheck(req(true), "create_requires_approval", approval);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: apiErrorRegistry.create_requires_approval.status,
      code: "create_requires_approval",
      message: approval.message,
      details: { environments: ["production"] },
    });
    expect(apiErrorRegistry.create_requires_approval.status).toBe(422);
  });

  it("records a notice instead while the setting is off", () => {
    const r = req(false);
    applySafetyCheck(r, "create_requires_approval", approval);
    expect(takeApiNotices(r)).toEqual([
      {
        code: "create_requires_approval",
        message: `${approval.notice} ${NOT_ENFORCED_SUFFIX}`,
        path: "environments",
      },
    ]);
  });

  it("treats an absent setting as off", () => {
    const r = req(undefined);
    expect(() =>
      applySafetyCheck(r, "create_requires_approval", approval),
    ).not.toThrow();
    expect(takeApiNotices(r)).toHaveLength(1);
  });

  it("does nothing when the check is not violated", () => {
    const r = req(true);
    applySafetyCheck(r, "create_requires_approval", {
      ...approval,
      violated: false,
    });
    expect(takeApiNotices(r)).toEqual([]);
  });

  it("hands notices out once, per request", () => {
    const first = req(false);
    const second = req(false);
    applySafetyCheck(first, "create_requires_approval", approval);
    expect(takeApiNotices(second)).toEqual([]);
    expect(takeApiNotices(first)).toHaveLength(1);
    expect(takeApiNotices(first)).toEqual([]);
  });
});

describe("runApiHandler notices", () => {
  it("adds the request's notices to a successful body", async () => {
    const r = { ...req(false), params: {}, query: {}, body: {} };
    const res = await runApiHandler(r, {}, async () => {
      applySafetyCheck(r, "create_requires_approval", approval);
      return { feature: { id: "f1" } };
    });
    expect(res).toEqual({
      status: 200,
      body: {
        feature: { id: "f1" },
        notices: [
          expect.objectContaining({ code: "create_requires_approval" }),
        ],
      },
    });
  });

  it("leaves a body without notices untouched", async () => {
    const r = { ...req(false), params: {}, query: {}, body: {} };
    const res = await runApiHandler(r, {}, async () => ({ ok: true }));
    expect(res.body).toEqual({ ok: true });
  });

  it("returns the check's error while the setting is on", async () => {
    const r = { ...req(true), params: {}, query: {}, body: {} };
    const res = await runApiHandler(r, {}, async () => {
      applySafetyCheck(r, "create_requires_approval", approval);
      return { ok: true };
    });
    expect(res).toEqual({
      status: 422,
      body: {
        message: approval.message,
        code: "create_requires_approval",
        details: { environments: ["production"] },
      },
    });
  });
});

describe("formatList", () => {
  it("joins with commas and a final 'and'", () => {
    expect(formatList(["dev"])).toBe("dev");
    expect(formatList(["dev", "production"])).toBe("dev and production");
    expect(formatList(["dev", "staging", "production"])).toBe(
      "dev, staging and production",
    );
  });
});
