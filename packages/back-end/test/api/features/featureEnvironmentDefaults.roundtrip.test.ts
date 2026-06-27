import request from "supertest";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// End-to-end (Mongo-backed) round-trip coverage for per-environment default
// value overrides across the v1 and v2 REST API boundary. This is the
// reviewer's core concern: an override — AND its removal — must survive being
// written via one API version and read back via the other, at BOTH the
// top-level `environments[env].defaultValue` and inside the revision
// sub-objects (`environmentDefaults`).
//
// NOTE: these suites require a running MongoDB (via mongodb-memory-server). In
// the sandbox the binary download is blocked (403 from fastdl.mongodb.org) so
// they cannot run locally — they only fail with `DownloadError`. They compile
// and are exercised in CI.

const FEATURE_ID = "feat_env_default_roundtrip";

const makeOrg = (
  environments: Array<{ id: string; parent?: string }>,
): OrganizationInterface =>
  ({
    id: "org_env_default_roundtrip",
    name: "Env Default Roundtrip",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {
      environments: environments.map((e) => ({ description: "", ...e })),
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

const ENVS = [{ id: "production" }, { id: "staging" }];

describe("per-environment default overrides — v1/v2 round-trip", () => {
  const { app, setReqContext } = setupApp();
  const org = makeOrg(ENVS);

  // --- helpers ------------------------------------------------------------

  const auth = (req: request.Test) =>
    req
      .set("Authorization", "Bearer foo")
      .set("Content-Type", "application/json");

  const createV1 = (
    body: Record<string, unknown>,
    environments: Record<string, unknown> = {},
  ) =>
    auth(request(app).post("/api/v1/features")).send({
      id: FEATURE_ID,
      valueType: "string",
      defaultValue: "base",
      environments: {
        production: { enabled: true, rules: [] },
        staging: { enabled: true, rules: [] },
        ...environments,
      },
      ...body,
    });

  const createV2 = (body: Record<string, unknown>) =>
    auth(request(app).post("/api/v2/features")).send({
      id: FEATURE_ID,
      valueType: "string",
      defaultValue: "base",
      environments: {
        production: { enabled: true },
        staging: { enabled: true },
      },
      ...body,
    });

  const updateV1 = (body: Record<string, unknown>) =>
    auth(request(app).post(`/api/v1/features/${FEATURE_ID}`)).send(body);

  const updateV2 = (body: Record<string, unknown>) =>
    auth(request(app).post(`/api/v2/features/${FEATURE_ID}`)).send(body);

  const getV1 = () =>
    auth(request(app).get(`/api/v1/features/${FEATURE_ID}?withRevisions=all`));

  const getV2 = () =>
    auth(request(app).get(`/api/v2/features/${FEATURE_ID}?withRevisions=all`));

  // Find the latest published revision's environmentDefaults from the returned
  // revisions array (the revision sub-object the reviewer wants checked).
  const latestRevEnvDefaults = (
    revisions: Array<Record<string, unknown>> | undefined,
  ): Record<string, string> | undefined => {
    if (!revisions?.length) return undefined;
    const sorted = [...revisions].sort(
      (a, b) => (b.version as number) - (a.version as number),
    );
    return sorted[0]?.environmentDefaults as Record<string, string> | undefined;
  };

  beforeEach(() => {
    setReqContext(makeContext(org));
  });

  describe("set via v2, read via v1 (and vice versa)", () => {
    it("v2 sets a per-env override -> v1 GET reflects it top-level AND in the revision", async () => {
      const create = await createV2({
        environments: {
          production: { enabled: true, defaultValue: "prod-override" },
          staging: { enabled: true },
        },
      });
      expect(create.status).toBe(200);

      const res = await getV1();
      expect(res.status).toBe(200);
      const feature = res.body.feature;
      // Top-level resolved value reflects the override for production and the
      // base for staging.
      expect(feature.environments.production.defaultValue).toBe(
        "prod-override",
      );
      expect(feature.environments.staging.defaultValue).toBe("base");
      // The revision sub-object carries the complete override snapshot.
      expect(latestRevEnvDefaults(feature.revisions)).toEqual({
        production: "prod-override",
      });
    });

    it("v1 sets a per-env override -> v2 GET reflects it top-level AND in the revision", async () => {
      const create = await createV1(
        {},
        {
          production: {
            enabled: true,
            rules: [],
            defaultValue: "prod-override",
          },
        },
      );
      expect(create.status).toBe(200);

      const res = await getV2();
      expect(res.status).toBe(200);
      const feature = res.body.feature;
      expect(feature.environments.production.defaultValue).toBe(
        "prod-override",
      );
      expect(feature.environments.staging.defaultValue).toBe("base");
      expect(latestRevEnvDefaults(feature.revisions)).toEqual({
        production: "prod-override",
      });
    });
  });

  describe("an override on one env survives an update to a different env", () => {
    it("set production via v1, then update staging via v2 — production override is not clobbered", async () => {
      await createV1(
        {},
        {
          production: {
            enabled: true,
            rules: [],
            defaultValue: "prod-override",
          },
        },
      );

      // Update a DIFFERENT env's override via v2 (general update merges per-env
      // values into the live snapshot — set/update only).
      const update = await updateV2({
        environments: {
          staging: { enabled: true, defaultValue: "staging-override" },
        },
      });
      expect(update.status).toBe(200);

      const res = await getV1();
      const feature = res.body.feature;
      // Both overrides present.
      expect(feature.environments.production.defaultValue).toBe(
        "prod-override",
      );
      expect(feature.environments.staging.defaultValue).toBe(
        "staging-override",
      );
      expect(latestRevEnvDefaults(feature.revisions)).toEqual({
        production: "prod-override",
        staging: "staging-override",
      });
    });

    it("set production via v2, then update staging via v1 — production override is not clobbered", async () => {
      await createV2({
        environments: {
          production: { enabled: true, defaultValue: "prod-override" },
          staging: { enabled: true },
        },
      });

      // v1 update of a DIFFERENT env (v1 env entries require `rules`).
      const update = await updateV1({
        environments: {
          staging: {
            enabled: true,
            rules: [],
            defaultValue: "staging-override",
          },
        },
      });
      expect(update.status).toBe(200);

      const res = await getV2();
      const feature = res.body.feature;
      expect(feature.environments.production.defaultValue).toBe(
        "prod-override",
      );
      expect(feature.environments.staging.defaultValue).toBe(
        "staging-override",
      );
      expect(latestRevEnvDefaults(feature.revisions)).toEqual({
        production: "prod-override",
        staging: "staging-override",
      });
    });
  });

  describe("clear survives the boundary", () => {
    it("dedicated unset endpoint removes the override — gone via v1 AND v2", async () => {
      await createV1(
        {},
        {
          production: {
            enabled: true,
            rules: [],
            defaultValue: "prod-override",
          },
        },
      );

      // Clear via the dedicated REST unset endpoint.
      const del = await auth(
        request(app).delete(
          `/api/v1/features/${FEATURE_ID}/default-value-per-environment/production`,
        ),
      ).send();
      expect(del.status).toBe(200);

      const v1 = await getV1();
      expect(v1.body.feature.environments.production.defaultValue).toBe("base");
      expect(latestRevEnvDefaults(v1.body.feature.revisions)).toEqual({});

      const v2 = await getV2();
      expect(v2.body.feature.environments.production.defaultValue).toBe("base");
      expect(latestRevEnvDefaults(v2.body.feature.revisions)).toEqual({});
    });

    it("dedicated set endpoint sets and publishes the override — reflected via GET", async () => {
      await createV1({});

      const set = await auth(
        request(app).post(
          `/api/v1/features/${FEATURE_ID}/default-value-per-environment`,
        ),
      ).send({ environment: "production", value: "prod-via-rest" });
      expect(set.status).toBe(200);

      const v2 = await getV2();
      expect(v2.body.feature.environments.production.defaultValue).toBe(
        "prod-via-rest",
      );
      expect(latestRevEnvDefaults(v2.body.feature.revisions)).toEqual({
        production: "prod-via-rest",
      });
    });
  });

  describe("create-with-override round-trips both directions", () => {
    it("v1 create with override -> v2 GET", async () => {
      await createV1(
        {},
        {
          staging: { enabled: true, rules: [], defaultValue: "s" },
        },
      );
      const res = await getV2();
      expect(res.body.feature.environments.staging.defaultValue).toBe("s");
    });

    it("v2 create with override -> v1 GET", async () => {
      await createV2({
        environments: {
          production: { enabled: true, defaultValue: "p" },
          staging: { enabled: true },
        },
      });
      const res = await getV1();
      expect(res.body.feature.environments.production.defaultValue).toBe("p");
    });
  });

  describe("validation across the boundary", () => {
    it("rejects an override that does not match the feature's valueType (dedicated set)", async () => {
      // number feature, then try to set a non-numeric override.
      await auth(request(app).post("/api/v1/features")).send({
        id: FEATURE_ID,
        valueType: "number",
        defaultValue: "1",
        environments: {
          production: { enabled: true, rules: [] },
          staging: { enabled: true, rules: [] },
        },
      });

      const set = await auth(
        request(app).post(
          `/api/v1/features/${FEATURE_ID}/default-value-per-environment`,
        ),
      ).send({ environment: "production", value: "abc" });
      expect(set.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(set.body)).toMatch(/number/i);
    });
  });

  describe("JSON null override is not mistaken for a clear", () => {
    it("sets a json override of the literal null and round-trips it as a real override", async () => {
      await auth(request(app).post("/api/v1/features")).send({
        id: FEATURE_ID,
        valueType: "json",
        defaultValue: JSON.stringify({ a: 1 }),
        environments: {
          production: { enabled: true, rules: [] },
          staging: { enabled: true, rules: [] },
        },
      });

      const set = await auth(
        request(app).post(
          `/api/v1/features/${FEATURE_ID}/default-value-per-environment`,
        ),
      ).send({ environment: "production", value: "null" });
      expect(set.status).toBe(200);

      // The override is a REAL value ("null"), not an absent/inherited override.
      const v1 = await getV1();
      expect(v1.body.feature.environments.production.defaultValue).toBe("null");
      expect(latestRevEnvDefaults(v1.body.feature.revisions)).toEqual({
        production: "null",
      });

      const v2 = await getV2();
      expect(v2.body.feature.environments.production.defaultValue).toBe("null");
      // staging inherits the base (object) default — proves null didn't leak.
      expect(v2.body.feature.environments.staging.defaultValue).toBe(
        JSON.stringify({ a: 1 }),
      );
    });
  });
});
