import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// A prerequisite may only point at an existing, unarchived boolean flag that
// does not depend on the feature being written — what the dashboard picker
// enforces. Every REST write path applies it, and only to parents the write
// introduces, so stored references to a since-archived parent still echo.

const ORG_ID = "org_prereq_parents";
const org = {
  id: ORG_ID,
  name: "Prereq Parents",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

function makeContext(): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
}

const now = () => new Date();
type Doc = Record<string, unknown>;

async function insertFeature(id: string, extra: Doc = {}): Promise<void> {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 2,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
    ...extra,
  });
}

async function insertDraftRevision(
  featureId: string,
  rules: Doc[] = [],
): Promise<void> {
  for (const [version, status] of [
    [1, "published"],
    [2, "draft"],
  ] as const) {
    await mongoose.connection.collection("featurerevisions").insertOne({
      id: `frev_${featureId}_${version}`,
      organization: ORG_ID,
      featureId,
      version,
      baseVersion: version - 1,
      status,
      createdBy: { type: "api_key", apiKey: "key_engineer" },
      comment: "",
      defaultValue: "false",
      rules: status === "draft" ? rules : [],
      dateCreated: now(),
      dateUpdated: now(),
      ...(status === "published" ? { datePublished: now() } : {}),
    });
  }
}

const prereq = (id: string) => ({ id, condition: '{"value": true}' });
const forceRule = (extra: Doc) => ({
  type: "force",
  value: "true",
  allEnvironments: true,
  ...extra,
});

describe("prerequisite parents on REST feature writes", () => {
  const { app, setReqContext } = setupApp();
  const FLAG = "child_flag";
  const RULES_V2 = `/api/v2/features/${FLAG}/revisions/2/rules`;
  const send = (method: "post" | "put", path: string, body: unknown) => {
    const agent = request(app);
    return agent[method](path).send(body).set("Authorization", "Bearer foo");
  };

  beforeEach(async () => {
    setReqContext(makeContext());
    await insertFeature(FLAG);
    await insertDraftRevision(FLAG, [
      forceRule({ id: "fr_edit", description: "", enabled: true }),
    ]);
    await insertFeature("parent_ok");
    await insertFeature("parent_archived", { archived: true });
    await insertFeature("parent_string", {
      valueType: "string",
      defaultValue: "a",
    });
    // parent_cyclic -> FLAG (top-level); parent_deep -> grandparent -> FLAG (rule)
    await insertFeature("parent_cyclic", { prerequisites: [prereq(FLAG)] });
    await insertFeature("grandparent", {
      rules: [forceRule({ id: "fr_gp", prerequisites: [prereq(FLAG)] })],
    });
    await insertFeature("parent_deep", {
      prerequisites: [prereq("grandparent")],
    });
  });

  const badParents: [string, string, number, RegExp][] = [
    ["a missing flag", "missing_flag", 404, /not found/],
    ["an archived flag", "parent_archived", 400, /is archived/],
    ["a non-boolean flag", "parent_string", 400, /boolean feature, not string/],
    ["the feature itself", FLAG, 400, /its own prerequisite/],
    ["a flag that depends on this one", "parent_cyclic", 400, /circular/],
    ["a flag two hops above this one", "parent_deep", 400, /circular/],
  ];

  it.each(badParents)(
    "v2 rule add rejects a prerequisite on %s",
    async (_label, id, status, re) => {
      const res = await send("post", RULES_V2, {
        rule: forceRule({ prerequisites: [prereq(id)] }),
      });
      expect(res.body.message).toMatch(re);
      expect(res.status).toBe(status);
    },
  );

  it("v2 rule add accepts a valid parent", async () => {
    const res = await send("post", RULES_V2, {
      rule: forceRule({ prerequisites: [prereq("parent_ok")] }),
    });
    expect(res.body.message).toBeUndefined();
    expect(res.status).toBe(200);
  });

  // One case per remaining write path proves the wiring; the rules themselves
  // are covered above.
  it.each([
    [
      "v1 rule add",
      () =>
        send("post", `/api/v1/features/${FLAG}/revisions/2/rules`, {
          environment: "production",
          rule: {
            type: "force",
            value: "true",
            prerequisites: [prereq("parent_archived")],
          },
        }),
      /is archived/,
    ],
    [
      "v2 rule patch",
      () =>
        send("put", `${RULES_V2}/fr_edit`, {
          rule: { prerequisites: [prereq("parent_cyclic")] },
        }),
      /circular/,
    ],
    [
      "v2 bulk create, feature-level prerequisites",
      () =>
        send("post", "/api/v2/features", {
          id: "new_flag",
          owner: "t",
          valueType: "boolean",
          defaultValue: "false",
          prerequisites: ["parent_string"],
        }),
      /boolean feature/,
    ],
    [
      "v1 bulk create, rule prerequisite",
      () =>
        send("post", "/api/v1/features", {
          id: "new_flag_v1",
          owner: "t",
          valueType: "boolean",
          defaultValue: "false",
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  value: "true",
                  prerequisites: [prereq("parent_archived")],
                },
              ],
            },
          },
        }),
      /is archived/,
    ],
    [
      "v2 bulk update, feature-level prerequisites",
      () =>
        send("post", `/api/v2/features/${FLAG}`, {
          prerequisites: ["parent_deep"],
        }),
      /circular/,
    ],
    [
      "v2 bulk update, rule prerequisite",
      () =>
        send("post", `/api/v2/features/${FLAG}`, {
          rules: [forceRule({ prerequisites: [prereq("parent_archived")] })],
        }),
      /is archived/,
    ],
    [
      "v1 bulk update, rule prerequisite",
      () =>
        send("post", `/api/v1/features/${FLAG}`, {
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "force",
                  value: "true",
                  prerequisites: [prereq("parent_string")],
                },
              ],
            },
          },
        }),
      /boolean feature/,
    ],
    [
      "revision prerequisites endpoint",
      () =>
        send("put", `/api/v2/features/${FLAG}/revisions/2/prerequisites`, {
          prerequisites: [{ id: "parent_cyclic" }],
        }),
      /circular/,
    ],
  ])("%s rejects a bad parent", async (_label, go, re) => {
    const res = await go();
    expect(res.body.message).toMatch(re);
    expect(res.status).toBe(400);
  });

  describe("a stored reference to a since-archived parent", () => {
    const stale = forceRule({
      id: "fr_stale",
      description: "",
      enabled: true,
      prerequisites: [prereq("parent_archived")],
    });

    beforeEach(async () => {
      await mongoose.connection.collection("features").updateOne(
        { id: FLAG },
        {
          $set: {
            rules: [stale],
            prerequisites: [prereq("parent_archived")],
          },
        },
      );
      await mongoose.connection
        .collection("featurerevisions")
        .updateOne(
          { featureId: FLAG, version: 2 },
          { $set: { rules: [stale] } },
        );
    });

    it("echoes on a bulk update and on an unrelated rule patch", async () => {
      const got = await request(app)
        .get(`/api/v2/features/${FLAG}`)
        .set("Authorization", "Bearer foo");
      const echoed = await send("post", `/api/v2/features/${FLAG}`, {
        rules: got.body.feature.rules,
        prerequisites: ["parent_archived"],
      });
      expect(echoed.body.message).toBeUndefined();
      expect(echoed.status).toBe(200);

      const patched = await send("put", `${RULES_V2}/fr_stale`, {
        rule: { description: "renamed" },
      });
      expect(patched.body.message).toBeUndefined();
      expect(patched.status).toBe(200);
    });

    it("still rejects a newly added bad parent on the same feature", async () => {
      const res = await send("post", RULES_V2, {
        rule: forceRule({ prerequisites: [prereq("parent_string")] }),
      });
      expect(res.body.message).toMatch(/boolean feature/);
      expect(res.status).toBe(400);
    });
  });
});
