import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createInitialRevision } from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api.setup";

// Sparse v1 env updates (POST /api/v1/features/:id with a subset of envs in
// `environments`) replace rules only for the envs in the payload. Rules in
// other envs — including multi-env collapsed rules and rules expanded into
// inheriting child envs at read time — are preserved, and the publish applies
// consistently to both the feature document and the published revision.

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
      { id: "qa" },
    ]);

    async function setup() {
      const context = makeContext(org);
      setReqContext(context);
      await seedFeature({
        rules: [
          {
            id: "fr_shared",
            allEnvironments: false,
            environments: ["production", "staging", "qa"],
            ...sharedRuleFields,
          },
        ],
        environmentSettings: {
          production: { enabled: true },
          staging: { enabled: true },
          qa: { enabled: false },
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
            qa: { enabled: false, rules: [] },
          },
        });

      expect(response.status).toBe(200);

      // The shared rule remains in place for production + staging; only the
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
        "qa",
      ]);

      // The published revision snapshot must also retain the full rules.
      const revision = await getRevisionDoc(2);
      expect(revision?.status).toBe("published");
      expect(revision?.rules).toHaveLength(1);
      expect(revision?.environmentsEnabled?.production).toBe(false);
    });

    it("round-trips a copied rule into a single shared entry", async () => {
      await setup();

      // Send the same rule (same id + content) to an env it already applies
      // to. This is a no-op: the rule stays a single shared entry rather
      // than splitting into per-env copies.
      const response = await request(app)
        .post(`/api/v1/features/${FEATURE_ID}`)
        .set("Authorization", "Bearer foo")
        .send({
          environments: {
            qa: {
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
        "qa",
      ]);
    });
  });

  describe("inheritance-expanded rules", () => {
    const org = makeOrg([
      { id: "production" },
      { id: "production-eu", parent: "production" },
    ]);

    it("keeps the ancestor env's rules when updating an inheriting child env", async () => {
      const context = makeContext(org);
      setReqContext(context);
      // production-eu has no explicit environmentSettings entry → it inherits
      // from production, and the JIT read expands the rule's env list to
      // include it. Replacing production-eu's rules only affects that env;
      // the production rule is preserved.
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
            "production-eu": { enabled: false, rules: [] },
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
      // Legacy live revision doc with rules stored as an empty v1 record.
      // The publish merge must baseline against the feature document (the
      // canonical live state), not this sparse doc, so the published change
      // is applied to the feature consistently.
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

      // The feature doc reflects the published revision.
      const doc = await getFeatureDoc();
      expect(doc.version).toBe(2);
      expect(doc.rules).toHaveLength(0);

      const revision = await getRevisionDoc(2);
      expect(revision?.status).toBe("published");
      expect(revision?.rules ?? []).toHaveLength(0);
    });
  });
});
