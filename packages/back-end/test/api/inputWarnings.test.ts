import { postFeatureV2Validator } from "shared/validators";
import { buildInputWarnings, runApiHandler } from "back-end/src/util/handler";

// The bulk write endpoints have non-strict nested objects, so an unrecognized
// field is dropped rather than rejected — silent from the caller's side. These
// advisories name what was ignored, and flag inputs accepted under a name that
// is no longer part of the documented contract.

describe("buildInputWarnings", () => {
  it("returns nothing when the body came through untouched", () => {
    const body = { rules: [{ type: "force", value: "true" }] };
    expect(buildInputWarnings(body, body)).toEqual([]);
  });

  it("names a top-level key that was stripped", () => {
    expect(buildInputWarnings({ id: "f", bogus: 1 }, { id: "f" })).toEqual([
      "Unrecognized field `bogus` was ignored.",
    ]);
  });

  it("names a stripped key inside an array element, with its index", () => {
    const raw = {
      rules: [{ type: "force" }, { type: "force", conditon: "{}" }],
    };
    const parsed = { rules: [{ type: "force" }, { type: "force" }] };
    expect(buildInputWarnings(raw, parsed)).toEqual([
      "Unrecognized field `rules[1].conditon` was ignored.",
    ]);
  });

  it("flags savedGroupTargeting as undocumented even though it is accepted", () => {
    const body = {
      rules: [{ savedGroupTargeting: [{ matchType: "all", savedGroups: [] }] }],
    };
    expect(buildInputWarnings(body, body)).toEqual([
      "`rules[0].savedGroupTargeting` is accepted for compatibility but is not part of the documented contract. Use `savedGroups` instead.",
    ]);
  });

  it("stays quiet for the documented savedGroups spelling", () => {
    const body = { rules: [{ savedGroups: [{ match: "all", ids: ["a"] }] }] };
    expect(buildInputWarnings(body, body)).toEqual([]);
  });

  it("reports both a stripped field and an undocumented one together", () => {
    const raw = {
      rules: [
        {
          savedGroupTargeting: [{ matchType: "all", savedGroups: [] }],
          nonsense: true,
        },
      ],
    };
    const parsed = {
      rules: [{ savedGroupTargeting: [{ matchType: "all", savedGroups: [] }] }],
    };
    expect(buildInputWarnings(raw, parsed)).toHaveLength(2);
  });

  it("does not treat a missing nested object as a stripped key", () => {
    expect(buildInputWarnings({ a: { b: 1 } }, { a: "replaced" })).toEqual([]);
  });
});

describe("input warnings end-to-end through runApiHandler", () => {
  const body = {
    id: "f",
    owner: "o",
    valueType: "boolean" as const,
    defaultValue: "false",
    rules: [
      {
        type: "force",
        value: "true",
        savedGroupTargeting: [{ matchType: "all", savedGroups: ["sg"] }],
        conditon: "{}",
      },
    ],
  };

  it("appends advisories to a 200 without blocking", async () => {
    const res = await runApiHandler(
      { params: {}, query: {}, body: JSON.parse(JSON.stringify(body)) },
      { body: postFeatureV2Validator.bodySchema },
      async () => ({ feature: { id: "f" } }),
      { surfaceInputWarnings: true },
    );
    expect(res.status).toBe(200);
    expect((res.body as { warnings: string[] }).warnings).toEqual([
      "Unrecognized field `rules[0].conditon` was ignored.",
      "`rules[0].savedGroupTargeting` is accepted for compatibility but is not part of the documented contract. Use `savedGroups` instead.",
    ]);
  });

  it("adds nothing when the endpoint has not opted in", async () => {
    const res = await runApiHandler(
      { params: {}, query: {}, body: JSON.parse(JSON.stringify(body)) },
      { body: postFeatureV2Validator.bodySchema },
      async () => ({ feature: { id: "f" } }),
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("warnings");
  });
});
