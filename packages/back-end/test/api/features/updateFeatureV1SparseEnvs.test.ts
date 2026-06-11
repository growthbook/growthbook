import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createInitialRevision } from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api.setup";

// Regression tests for the 2026-06-11 incident: a sparse v1 env update
// (POST /api/v1/features/:id with a single env in `environments`) must never
// delete rules from environments the caller didn't touch.
//
// Two root causes covered:
//  1. updateFeature.ts dropped any v2 rule whose env list intersected the
//     touched envs (multi-env collapsed rules + inheritance-expanded rules),
//     instead of splitting the rule and keeping the untouched envs.
//  2. createAndPublishRevision diffed the draft against the STORED live
//     revision doc; a sparse/legacy doc made the merge silently no-op while
//     the bogus revision was still marked published.

const FEATURE_ID = "feat_sparse_env_test";

const makeOrg = (
  environments: Array<{ id: string; parent?: string }>,
): OrganizationInterface =>
  ({
    id: "org_sparse_env_test",
    name: "Sparse Env Test",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {
      environments: environments.map((e) => ({
        description: "",
        ...e,
      })),
    },
  }) as unknown as OrganizationInterface;

function makeContext(org: OrganizationInterface) {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });
}

const sharedRuleFields = {
  type: "force",
  description: "",
  value: "on",
  condition: "{}",
  savedGroups: [],
  enabled: true,
};

async function seedFeature({
  rules,
  environmentSettings,
}: {
  rules: Array<Record<string, unknown>>;
  environmentSettings: Record<string, { enabled: boolean }>;
}) {
  await mongoose.connection.collection("features").insertOne({
    id: FEATURE_ID,
    organization: "org_sparse_env_test",
    version: 1,
    defaultValue: "off",
    valueType: "string",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    rules,
    environmentSettings,
    archived: false,
  });
}

async function seedPublishedRevisionFromFeature(context: ReqContextClass) {
  const feature = await getFeature(context, FEATURE_ID);
  if (!feature) throw new Error("seed feature missing");
  await createInitialRevision(
    context,
    feature,
    context.auditUser,
    Object.keys(feature.environmentSettings ?? {}),
  );
}

async function getFeatureDoc() {
  const doc = await mongoose.connection
    .collection("features")
    .findOne({ id: FEATURE_ID });
  if (!doc) throw new Error("feature doc missing");
  return doc;
}

async function getRevisionDoc(version: number) {
  return mongoose.connection
    .collection("featurerevisions")
    .findOne({ featureId: FEATURE_ID, version });
}

describe("POST /api/v1/features/:id with sparse environments", () => {
  const { app, setReqContext } = setupApp();

  describe("multi-env collapsed rules", () => {
    const org = makeOrg([
      { id: "production" },
      { id: "staging" },
      { id: "azure-gov-staging" },
    ]);

    async function setup() {
      const context = makeContext(org);
      setReqContext(context);
      await seedFeature({
        rules: [
          {
            id: "fr_shared",
            allEnvironments: false,
            environments: ["production", "staging", "azure-gov-staging"],
            ...sharedRuleFields,
          },
        ],
        environmentSettings: {
          production: { enabled: true },
          staging: { enabled: true },
          "azure-gov-staging": { enabled: false },
        },
      });
      await seedPublishedRevisionFromFeature(context);
      return context;
    }

    it("keeps untouched envs' rules when one env's rules are replaced with []", async () => {
      await setup();

      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            "azure-gov-staging": { enabled: false, rules: [] },
          },
        });

      expect(response.status).toBe(200);

      // The shared rule must survive for production + staging; only the
      // touched env is removed from its scope.
      const doc = await getFeatureDoc();
      expect(doc.version).toBe(2);
      expect(doc.rules).toHaveLength(1);
      expect(doc.rules[0].id).toBe("fr_shared");
      expect(doc.rules[0].environments).toEqual(["production", "staging"]);

      // The published revision must carry the same (non-empty) rules.
      const revision = await getRevisionDoc(2);
      expect(revision?.status).toBe("published");
      expect(revision?.rules).toHaveLength(1);
      expect(revision?.rules[0].environments).toEqual([
        "production",
        "staging",
      ]);
    });

    it("does not touch other envs' rules on an enabled toggle with round-tripped rules", async () => {
      await setup();

      // The v1 contract requires `rules` on every env entry, so a kill-switch
      // flip round-trips the env's current rules alongside `enabled`.
      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            production: {
              enabled: false,
              rules: [
                {
                  id: "fr_shared",
                  type: "force",
                  value: "on",
                  description: "",
                  condition: "{}",
                  enabled: true,
                },
              ],
            },
          },
        });

      expect(response.status).toBe(200);

      const doc = await getFeatureDoc();
      expect(doc.environmentSettings.production.enabled).toBe(false);
      expect(doc.rules).toHaveLength(1);
      expect(doc.rules[0].environments).toEqual([
        "production",
        "staging",
        "azure-gov-staging",
      ]);

      // The published revision snapshot must also retain the full rules.
      const revision = await getRevisionDoc(2);
      expect(revision?.status).toBe("published");
      expect(revision?.rules).toHaveLength(1);
      expect(revision?.environmentsEnabled?.production).toBe(false);
    });

    it("round-trips a copied rule into a single shared entry", async () => {
      await setup();

      // Copy the same rule (same id + content) into the touched env — the
      // v1 "copy env state" pattern. The rule already applies there, so this
      // must be a no-op, not a delete + re-add.
      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            "azure-gov-staging": {
              enabled: false,
              rules: [
                {
                  id: "fr_shared",
                  type: "force",
                  value: "on",
                  description: "",
                  condition: "{}",
                  enabled: true,
                },
              ],
            },
          },
        });

      expect(response.status).toBe(200);

      const doc = await getFeatureDoc();
      // No content change → no new revision needed.
      expect(doc.version).toBe(1);
      expect(doc.rules).toHaveLength(1);
      expect(doc.rules[0].environments).toEqual([
        "production",
        "staging",
        "azure-gov-staging",
      ]);
    });
  });

  describe("inheritance-expanded rules", () => {
    const org = makeOrg([
      { id: "production" },
      { id: "azure-prod", parent: "production" },
    ]);

    it("keeps the ancestor env's rules when updating an inheriting child env", async () => {
      const context = makeContext(org);
      setReqContext(context);
      // azure-prod has NO explicit environmentSettings entry → it inherits
      // from production, and the JIT read expands the rule's env list to
      // include it. Replacing azure-prod's rules must not delete the
      // production rule.
      await seedFeature({
        rules: [
          {
            id: "fr_prod_only",
            allEnvironments: false,
            environments: ["production"],
            ...sharedRuleFields,
          },
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      });
      await seedPublishedRevisionFromFeature(context);

      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            "azure-prod": { enabled: false, rules: [] },
          },
        });

      expect(response.status).toBe(200);

      const doc = await getFeatureDoc();
      expect(doc.rules).toHaveLength(1);
      expect(doc.rules[0].id).toBe("fr_prod_only");
      expect(doc.rules[0].environments).toEqual(["production"]);
    });
  });

  describe("stale live revision doc (publish merge baseline)", () => {
    const org = makeOrg([{ id: "production" }, { id: "staging" }]);

    it("applies the published revision to the feature even when the stored live revision is sparse", async () => {
      const context = makeContext(org);
      setReqContext(context);
      await seedFeature({
        rules: [
          {
            id: "fr_prod",
            allEnvironments: false,
            environments: ["production"],
            ...sharedRuleFields,
          },
        ],
        environmentSettings: {
          production: { enabled: true },
          staging: { enabled: true },
        },
      });
      // Legacy live revision doc: rules stored as an empty v1 record. Before
      // the fix, the publish merge used this as its baseline, concluded
      // "no rule changes", skipped the feature write, and still marked the
      // new revision published.
      await mongoose.connection.collection("featurerevisions").insertOne({
        organization: "org_sparse_env_test",
        featureId: FEATURE_ID,
        version: 1,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        datePublished: new Date(),
        createdBy: { type: "api_key", apiKey: "key_test" },
        baseVersion: 0,
        status: "published",
        publishedBy: { type: "api_key", apiKey: "key_test" },
        comment: "",
        defaultValue: "off",
        rules: {},
        environmentsEnabled: { production: true, staging: true },
      });

      // Explicitly empty production's rules — a legitimate delete.
      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            production: { enabled: true, rules: [] },
          },
        });

      expect(response.status).toBe(200);

      // The feature doc must actually reflect the published revision.
      const doc = await getFeatureDoc();
      expect(doc.version).toBe(2);
      expect(doc.rules).toHaveLength(0);

      const revision = await getRevisionDoc(2);
      expect(revision?.status).toBe("published");
      expect(revision?.rules ?? []).toHaveLength(0);
    });
  });
});
