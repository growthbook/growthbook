import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// The uniform archive-dependents guard: archiving an entity that still has live
// dependents is a SOFT, acknowledgeable warning (422), NOT a hard block. It is
// cleared by `ignoreWarnings` alone (no elevated permission). Unarchiving is
// never guarded. A config consumed by a live FEATURE FLAG gets an ELEVATED
// message. Covers configs, constants, and saved groups (the direct archive
// endpoints); the feature path is a publish-time soft gate exercised elsewhere.

const ORG_ID = "org_archive_dependents";

const org = {
  id: ORG_ID,
  name: "Archive Dependents",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production", description: "" }],
  },
} as unknown as OrganizationInterface;

// Engineer can edit these entities but cannot bypass approval checks, so the
// soft guard actually blocks (an admin would clear it via bypassApprovalChecks).
// `ignoreWarnings` is baked onto the context's own request — context.ignoreWarnings
// reads context.req, not the HTTP body the mock middleware discards.
function engineer(opts: { ignoreWarnings?: boolean } = {}): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: {
      query: {},
      headers: {},
      body: opts.ignoreWarnings ? { ignoreWarnings: true } : {},
    } as unknown as Request,
  });
}

function insertFeature(doc: Record<string, unknown>) {
  return mongoose.connection.collection("features").insertOne({
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "string",
    defaultValue: "x",
    tags: [],
    project: "",
    archived: false,
    version: 1,
    prerequisites: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...doc,
  });
}

function insertConfig(doc: Record<string, unknown>) {
  const now = new Date();
  return mongoose.connection.collection("configs").insertOne({
    organization: ORG_ID,
    name: "",
    owner: "",
    value: JSON.stringify({ hello: "world" }),
    archived: false,
    dateCreated: now,
    dateUpdated: now,
    ...doc,
  });
}

function insertConstant(doc: Record<string, unknown>) {
  const now = new Date();
  return mongoose.connection.collection("constants").insertOne({
    organization: ORG_ID,
    name: "",
    owner: "",
    type: "string",
    value: "hello",
    archived: false,
    dateCreated: now,
    dateUpdated: now,
    ...doc,
  });
}

function insertSavedGroup(doc: Record<string, unknown>) {
  const now = new Date();
  return mongoose.connection.collection("savedgroups").insertOne({
    organization: ORG_ID,
    groupName: "",
    owner: "",
    type: "condition",
    condition: '{"id": {"$in": ["a"]}}',
    archived: false,
    dateCreated: now,
    dateUpdated: now,
    ...doc,
  });
}

const { app, setReqContext } = setupApp();

describe("Archive-dependents soft guard", () => {
  describe("POST /api/v1/configs/:key/archive", () => {
    it("elevates the warning when a live feature flag consumes the config, and ignoreWarnings clears it", async () => {
      const key = "cfg_consumed_by_flag";
      await insertConfig({
        id: "cfg_c1",
        key,
        value: JSON.stringify({ a: 1 }),
      });
      // A live feature whose config-backed value pulls in @config:<key> via
      // $extends (the reference form the resolver acts on).
      await insertFeature({
        id: "flag_uses_config",
        valueType: "json",
        defaultValue: `{"$extends":["@config:${key}"]}`,
      });

      setReqContext(engineer());
      const blocked = await request(app)
        .post(`/api/v1/configs/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(422);
      // Elevated wording (config consumed by a live feature flag).
      expect(blocked.body.message).toMatch(/live feature flag/i);
      // Standard publish-gate contract: a structured gate the caller can
      // introspect (type + how to clear it), not just a prose warning.
      expect(blocked.body.gates).toEqual([
        expect.objectContaining({
          type: "archive-dependents",
          severity: "warning",
          override: "ignoreWarnings",
          requiresPermission: null,
          resolution: null,
        }),
      ]);

      // Not archived yet.
      const still = await mongoose.connection
        .collection("configs")
        .findOne({ key, organization: ORG_ID });
      expect(!!still?.archived).toBe(false);

      // Acknowledge with ignoreWarnings → archives.
      setReqContext(engineer({ ignoreWarnings: true }));
      const ok = await request(app)
        .post(`/api/v1/configs/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);
      const archived = await mongoose.connection
        .collection("configs")
        .findOne({ key, organization: ORG_ID });
      expect(archived?.archived).toBe(true);
    });

    it("uses the normal (non-elevated) message when only another config references it", async () => {
      const key = "cfg_consumed_by_config";
      await insertConfig({ id: "cfg_c2", key });
      // A live config that inherits from the target (lineage dependent).
      await insertConfig({
        id: "cfg_c2_dep",
        key: "cfg_c2_dep",
        parent: key,
      });

      setReqContext(engineer());
      const blocked = await request(app)
        .post(`/api/v1/configs/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toMatch(/config\(s\)/i);
      expect(blocked.body.message).not.toMatch(/live feature flag/i);
    });

    it("allows archiving a config with no dependents, and never guards unarchive", async () => {
      const key = "cfg_no_deps";
      await insertConfig({ id: "cfg_c3", key });

      setReqContext(engineer());
      const ok = await request(app)
        .post(`/api/v1/configs/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);

      // Unarchive is never guarded even if something references it.
      await insertFeature({
        id: "flag_uses_c3",
        valueType: "json",
        defaultValue: `{"$extends":["@config:${key}"]}`,
      });
      const unok = await request(app)
        .post(`/api/v1/configs/${key}/unarchive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(unok.status).toBe(200);
    });
  });

  describe("POST /api/v1/constants/:key/archive", () => {
    it("soft-warns when referenced, and ignoreWarnings clears it", async () => {
      const key = "const_referenced";
      await insertConstant({ id: "const_k1", key });
      // A live feature interpolating @const:<key> in its value.
      await insertFeature({
        id: "flag_uses_const",
        defaultValue: `{{ @const:${key} }}`,
      });

      setReqContext(engineer());
      const blocked = await request(app)
        .post(`/api/v1/constants/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toMatch(/feature/i);

      setReqContext(engineer({ ignoreWarnings: true }));
      const ok = await request(app)
        .post(`/api/v1/constants/${key}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);
    });
  });

  describe("POST /api/v1/saved-groups/:id/archive", () => {
    it("soft-warns when referenced, clears with ignoreWarnings, and never guards unarchive", async () => {
      const id = "grp_archive_referenced";
      await insertSavedGroup({ id, groupName: "Target group" });
      // A live feature rule embedding the group id makes it a dependent.
      await insertFeature({
        id: "flag_uses_grp",
        rules: [
          {
            id: "fr_grp",
            type: "force",
            value: "x",
            enabled: true,
            allEnvironments: true,
            condition: `{"$groups": {"$in": ["${id}"]}}`,
          },
        ],
      });

      setReqContext(engineer());
      const blocked = await request(app)
        .post(`/api/v1/saved-groups/${id}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toMatch(/feature/i);

      const still = await mongoose.connection
        .collection("savedgroups")
        .findOne({ id });
      expect(!!still?.archived).toBe(false);

      setReqContext(engineer({ ignoreWarnings: true }));
      const ok = await request(app)
        .post(`/api/v1/saved-groups/${id}/archive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);
      const archived = await mongoose.connection
        .collection("savedgroups")
        .findOne({ id });
      expect(archived?.archived).toBe(true);

      // Unarchive is never guarded.
      setReqContext(engineer());
      const unok = await request(app)
        .post(`/api/v1/saved-groups/${id}/unarchive`)
        .send({})
        .set("Authorization", "Bearer foo");
      expect(unok.status).toBe(200);
    });
  });
});
