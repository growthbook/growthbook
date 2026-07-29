import request from "supertest";
import type { OrganizationInterface } from "shared/types/organization";
import { setupApp } from "./api.setup";
import {
  buildOrg,
  makePersonaContext,
  PERSONA_IDS,
  Persona,
} from "./permission-personas.fixture";

/**
 * Persona x action matrix for Feature Flags, driven through the real REST
 * handlers — nothing about permissions is mocked, so this exercises the actual
 * atoms, the actual routing, and the actual gates.
 *
 * Each case names the personas that should be ALLOWED. Anyone else must be
 * refused with 403. A case failing in either direction is a real defect: an
 * unexpected allow is a hole, an unexpected deny is a persona that can't do its
 * job.
 */

const ORG_ID = "org_perm_matrix_features";
const org: OrganizationInterface = buildOrg(ORG_ID);
const { app, setReqContext } = setupApp();

const FEATURE_ID = "feat_matrix";

function as(persona: Persona | "admin", envLimited = false) {
  const role =
    persona === "admin" ? "admin" : envLimited ? `${persona}_dev` : persona;
  const userId = persona === "admin" ? "u_admin" : `u_${role}`;
  setReqContext(makePersonaContext(org, role, userId));
}

const api = {
  post: (path: string, body: Record<string, unknown> = {}) =>
    request(app).post(path).send(body).set("Authorization", "Bearer x"),
  put: (path: string, body: Record<string, unknown> = {}) =>
    request(app).put(path).send(body).set("Authorization", "Bearer x"),
  delete: (path: string) =>
    request(app).delete(path).set("Authorization", "Bearer x"),
};

/** Rebuild the feature under test as admin, so each case starts clean. */
async function seedFeature() {
  as("admin");
  const seeded = await api.post("/api/v1/features", {
    id: FEATURE_ID,
    valueType: "boolean",
    defaultValue: "false",
    owner: "u_admin",
    environments: {
      dev: { enabled: true, rules: [] },
      production: { enabled: true, rules: [] },
    },
  });
  if (seeded.status >= 400) {
    throw new Error(
      `seed failed: ${seeded.status} ${JSON.stringify(seeded.body)}`,
    );
  }
}

type Case = {
  name: string;
  allowed: Persona[];
  run: () => Promise<{ status: number }>;
};

const CASES: Case[] = [
  {
    // A flag enabling no environment is in no payload, so create stands alone.
    name: "create a flag",
    allowed: ["creator", "creatorPublisher", "full"],
    run: () =>
      api.post("/api/v1/features", {
        id: `feat_new_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        valueType: "boolean",
        defaultValue: "false",
        owner: "u_admin",
      }),
  },
  {
    // Enabling an environment IS the live write, so it takes publish there too.
    name: "create a flag already enabled in an environment",
    allowed: ["creatorPublisher", "full"],
    run: () =>
      api.post("/api/v1/features", {
        id: `feat_live_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        valueType: "boolean",
        defaultValue: "false",
        owner: "u_admin",
        environments: { production: { enabled: true, rules: [] } },
      }),
  },
  {
    name: "open a draft",
    allowed: ["drafter", "editor", "full"],
    run: () => api.post(`/api/v1/features/${FEATURE_ID}/revisions`, {}),
  },
  {
    // A direct update authors content AND lands it, so it takes both atoms.
    // Publish alone lands someone else's draft; it does not license writing
    // new content straight to the payload.
    name: "land a change directly (v2 update)",
    allowed: ["editor", "full"],
    run: () =>
      api.post(`/api/v2/features/${FEATURE_ID}`, { defaultValue: "true" }),
  },
  {
    // Metadata never reaches the payload, so the landing gate doesn't apply
    // and a drafter can do it — matching what `manageFeatures` allowed before
    // the split.
    name: "update metadata only (v2 update)",
    allowed: ["drafter", "editor", "full"],
    run: () =>
      api.post(`/api/v2/features/${FEATURE_ID}`, { description: "hello" }),
  },
  {
    name: "toggle an environment",
    allowed: ["publisher", "creatorPublisher", "editor", "full"],
    run: () =>
      api.post(`/api/v1/features/${FEATURE_ID}/toggle`, {
        environments: { dev: false },
      }),
  },
];

describe("permission matrix — Feature Flags", () => {
  beforeEach(async () => {
    await seedFeature();
  });

  describe.each(CASES)("$name", ({ allowed, run }) => {
    it.each(PERSONA_IDS)("%s", async (persona) => {
      as(persona);
      const res = (await run()) as { status: number; body?: unknown };
      // Carry the body into the assertion (as the entities matrix does): a 400
      // from a malformed request would otherwise look like a permission result
      // and make the case vacuous for everyone.
      const actual = `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 200)}`;
      // Allowed personas must actually succeed, not merely avoid a 403.
      if (allowed.includes(persona)) {
        expect(actual).toMatch(/^[123]\d\d /);
      } else {
        expect(actual).toMatch(/^403 /);
      }
    });
  });
});
