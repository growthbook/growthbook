import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// An experiment-ref rule's variations must be exactly the experiment's
// variations, matched by id. The payload serves null for any arm it cannot
// match, so a stray id would be a silent outage for that arm. Only writes that
// change the experiment or the ids are checked, so a stored rule whose
// experiment has since changed still round-trips.

const ORG_ID = "org_exp_variations";
const org = {
  id: ORG_ID,
  name: "Exp Variations",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const now = () => new Date();
type Doc = Record<string, unknown>;

async function insertFeature(id: string, rules: Doc[] = []): Promise<void> {
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
    rules,
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

async function insertDraftRevision(featureId: string, rules: Doc[] = []) {
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

async function insertExperiment(id: string, variationIds: string[]) {
  await mongoose.connection.collection("experiments").insertOne({
    id,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: id,
    type: "standard",
    status: "draft",
    archived: false,
    variations: variationIds.map((vid, i) => ({
      id: vid,
      key: String(i),
      name: vid,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        name: "Main",
        dateStarted: now(),
        coverage: 1,
        variationWeights: variationIds.map(() => 1 / variationIds.length),
      },
    ],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

const EXP = "exp_ab";
const arms = (...ids: string[]) =>
  ids.map((variationId, i) => ({ variationId, value: String(i % 2 === 0) }));
const expRef = (variations: Doc[], extra: Doc = {}) => ({
  type: "experiment-ref",
  experimentId: EXP,
  variations,
  allEnvironments: true,
  ...extra,
});

describe("experiment-ref rule variations", () => {
  const { app, setReqContext } = setupApp();
  const FLAG = "flag_exp";
  const RULES_V2 = `/api/v2/features/${FLAG}/revisions/2/rules`;
  const send = (method: "post" | "put", path: string, body: unknown) => {
    const agent = request(app);
    return agent[method](path).send(body).set("Authorization", "Bearer foo");
  };

  beforeEach(async () => {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_engineer" },
        role: "engineer",
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
    await insertExperiment(EXP, ["v0", "v1"]);
    await insertFeature(FLAG);
    await insertDraftRevision(FLAG, [
      {
        ...expRef(arms("v0", "v1")),
        id: "fr_exp",
        description: "",
        enabled: true,
      },
    ]);
  });

  it("v2 rule add accepts matching ids in any order, back-fills when all are omitted, and counts back-filled arms", async () => {
    for (const variations of [
      arms("v1", "v0"),
      [{ value: "true" }, { value: "false" }],
    ]) {
      const res = await send("post", RULES_V2, { rule: expRef(variations) });
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    }
    const short = await send("post", RULES_V2, {
      rule: expRef([{ value: "true" }]),
    });
    expect(short.body.message).toMatch(
      /has 2 variation\(s\) but 1 were specified/,
    );
    expect(short.status).toBe(400);
  });

  // One case per write path proves the wiring; the rules themselves are unit
  // tested in v2Shared.test.ts.
  it.each([
    [
      "v2 rule add",
      () => send("post", RULES_V2, { rule: expRef(arms("v0", "v9")) }),
    ],
    [
      "v1 rule add",
      () =>
        send("post", `/api/v1/features/${FLAG}/revisions/2/rules`, {
          environment: "production",
          rule: {
            type: "experiment-ref",
            experimentId: EXP,
            variations: arms("v0", "v9"),
          },
        }),
    ],
    [
      "v2 rule patch",
      () =>
        send("put", `${RULES_V2}/fr_exp`, {
          rule: { variations: arms("v0", "v9") },
        }),
    ],
    [
      "v1 rule patch",
      () =>
        send("put", `/api/v1/features/${FLAG}/revisions/2/rules/fr_exp`, {
          environment: "production",
          rule: { variations: arms("v0", "v9") },
        }),
    ],
    [
      "v2 bulk create",
      () =>
        send("post", "/api/v2/features", {
          id: "flag_new",
          owner: "t",
          valueType: "boolean",
          defaultValue: "false",
          rules: [expRef(arms("v0", "v9"))],
        }),
    ],
    [
      "v1 bulk create",
      () =>
        send("post", "/api/v1/features", {
          id: "flag_new_v1",
          owner: "t",
          valueType: "boolean",
          defaultValue: "false",
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "experiment-ref",
                  experimentId: EXP,
                  variations: arms("v0", "v9"),
                },
              ],
            },
          },
        }),
    ],
    [
      "v1 bulk update",
      () =>
        send("post", `/api/v1/features/${FLAG}`, {
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  type: "experiment-ref",
                  experimentId: EXP,
                  variations: arms("v0", "v9"),
                },
              ],
            },
          },
        }),
    ],
  ])("%s rejects a stray variation id", async (_label, go) => {
    const res = await go();
    expect(res.body.message).toMatch(/"v9" is not a variation/);
    expect(res.status).toBe(400);
  });

  describe("a stored rule whose experiment has since changed", () => {
    beforeEach(async () => {
      // The experiment dropped v1 and gained v2 after the rule was written.
      await mongoose.connection.collection("experiments").updateOne(
        { id: EXP },
        {
          $set: {
            variations: [
              { id: "v0", key: "0", name: "v0" },
              { id: "v2", key: "1", name: "v2" },
            ],
          },
        },
      );
      const stale = {
        ...expRef(arms("v0", "v1")),
        id: "fr_stale",
        description: "",
        enabled: true,
      };
      await insertFeature("flag_stale", [stale]);
      await insertDraftRevision("flag_stale", [stale]);
    });

    it("accepts a values-only patch", async () => {
      const res = await send(
        "put",
        "/api/v2/features/flag_stale/revisions/2/rules/fr_stale",
        {
          rule: {
            variations: arms("v0", "v1").map((a) => ({ ...a, value: "false" })),
          },
        },
      );
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it("echoes on a bulk update but is re-checked when its ids change", async () => {
      const got = await request(app)
        .get("/api/v2/features/flag_stale")
        .set("Authorization", "Bearer foo");
      const echoed = await send("post", "/api/v2/features/flag_stale", {
        rules: got.body.feature.rules,
      });
      expect(echoed.body.message).toBeUndefined();
      expect(echoed.status).toBe(200);

      const changed = await send("post", "/api/v2/features/flag_stale", {
        rules: [{ ...expRef(arms("v0", "v1", "v9")), id: "fr_stale" }],
      });
      expect(changed.body.message).toMatch(/"v1" is not a variation/);
      expect(changed.status).toBe(400);
    });
  });
});
