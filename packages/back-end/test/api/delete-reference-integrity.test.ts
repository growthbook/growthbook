import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// Reference-integrity guards on the delete paths. Deleting a still-referenced
// entity leaves a dangling reference that silently breaks SDK-served behavior,
// so both delete handlers block regardless of archived state or REST bypass:
//  1. A Saved Group referenced by a live feature rule can't be deleted (even
//     when REST bypass is enabled) until the reference is removed.
//  2. A Feature Flag used as another live feature's prerequisite can't be
//     deleted until the dependent drops it.

const ORG_ID = "org_delete_ref_integrity";

// restApiBypassesReviews makes canUseRestApiBypassSetting true, so the
// archived-first delete gate is waived — isolating the reference-integrity
// guard, which must still block.
const org = {
  id: ORG_ID,
  name: "Delete Reference Integrity",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    restApiBypassesReviews: true,
    environments: [{ id: "production", description: "" }],
  },
} as unknown as OrganizationInterface;

function makeContext(): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
}

// A live v2 feature: `rules` carry `allEnvironments`, which marks the doc v2 so
// migration preserves the flat rule array on read.
function insertFeature(doc: Record<string, unknown>) {
  return mongoose.connection.collection("features").insertOne({
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "true",
    tags: [],
    project: "",
    archived: false,
    version: 1,
    prerequisites: [],
    rules: [],
    environmentSettings: {
      production: { enabled: true, rules: [] },
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...doc,
  });
}

describe("Delete reference integrity", () => {
  const { app, setReqContext } = setupApp();

  describe("DELETE /api/v1/saved-groups/:id", () => {
    it("blocks deleting a Saved Group a live feature rule references, even with REST bypass on", async () => {
      setReqContext(makeContext());

      const groupId = "grp_referenced";
      // Not archived — with REST bypass on, the archived-first gate is waived,
      // so only the reference-integrity guard can block this delete.
      await mongoose.connection.collection("savedgroups").insertOne({
        id: groupId,
        organization: ORG_ID,
        groupName: "Referenced group",
        owner: "",
        type: "condition",
        condition: '{"id": {"$in": ["a"]}}',
        archived: false,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });

      // A live feature whose rule condition embeds the group id.
      await insertFeature({
        id: "flag_uses_group",
        rules: [
          {
            id: "fr_uses_group",
            type: "force",
            value: "true",
            enabled: true,
            allEnvironments: true,
            condition: `{"$groups": {"$in": ["${groupId}"]}}`,
          },
        ],
      });

      const blocked = await request(app)
        .delete(`/api/v1/saved-groups/${groupId}`)
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/still referenced/i);
      expect(blocked.body.message).toMatch(/feature/i);

      // The group is untouched.
      const stillThere = await mongoose.connection
        .collection("savedgroups")
        .findOne({ id: groupId });
      expect(stillThere).not.toBeNull();

      // Remove the reference; the delete now succeeds.
      await mongoose.connection
        .collection("features")
        .deleteOne({ id: "flag_uses_group" });

      const ok = await request(app)
        .delete(`/api/v1/saved-groups/${groupId}`)
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);

      const gone = await mongoose.connection
        .collection("savedgroups")
        .findOne({ id: groupId });
      expect(gone).toBeNull();
    });
  });

  describe("DELETE /api/v2/features/:id", () => {
    it("blocks deleting a Feature Flag a live feature lists as a prerequisite", async () => {
      setReqContext(makeContext());

      // The feature being deleted is archived (so the archived-first gate is
      // satisfied) yet a LIVE feature still gates on it — the dangling case.
      await insertFeature({ id: "prereq_flag", archived: true });
      await insertFeature({
        id: "dependent_flag",
        prerequisites: [{ id: "prereq_flag", condition: '{"value": true}' }],
      });

      const blocked = await request(app)
        .delete(`/api/v2/features/prereq_flag`)
        .set("Authorization", "Bearer foo");
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/prerequisite/i);
      // Count-only (no ids) — the scan is org-wide, so naming would leak
      // cross-project features.
      expect(blocked.body.message).toMatch(/1 live Feature Flag/i);

      const stillThere = await mongoose.connection
        .collection("features")
        .findOne({ id: "prereq_flag" });
      expect(stillThere).not.toBeNull();

      // Drop the dependent; the delete now succeeds.
      await mongoose.connection
        .collection("features")
        .deleteOne({ id: "dependent_flag" });

      const ok = await request(app)
        .delete(`/api/v2/features/prereq_flag`)
        .set("Authorization", "Bearer foo");
      expect(ok.status).toBe(200);

      const gone = await mongoose.connection
        .collection("features")
        .findOne({ id: "prereq_flag" });
      expect(gone).toBeNull();
    });
  });
});
