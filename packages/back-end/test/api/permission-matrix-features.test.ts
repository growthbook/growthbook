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

/** A draft opened by the ADMIN, so no persona under test is ever its author. */
async function seedDraft(): Promise<number> {
  as("admin");
  const res = await api.post(`/api/v2/features/${FEATURE_ID}/revisions`, {});
  if (res.status >= 400) {
    throw new Error(
      `draft seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as { revision?: { version?: number } };
  const version = body.revision?.version;
  if (!version) {
    throw new Error(`draft seed returned no version: ${JSON.stringify(body)}`);
  }
  return version;
}

/** The admin's draft whose ONLY proposed change is the archive flip. */
async function seedArchiveDraft(): Promise<number> {
  const version = await seedDraft();
  as("admin");
  const res = await api.put(
    `/api/v2/features/${FEATURE_ID}/revisions/${version}/archive`,
    { archived: true, ignoreWarnings: true },
  );
  if (res.status >= 400) {
    throw new Error(
      `archive-draft seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return version;
}

type Case = {
  name: string;
  allowed: Persona[];
  /**
   * Who is still allowed once the persona is restricted to `dev`. Omit when the
   * restriction changes nothing — either the action is project-scoped, or its
   * environment footprint is empty or confined to dev. Spell it out when the
   * footprint reaches production, which is the whole point of the dimension: an
   * environment-scoped atom must refuse a change that lands outside its scope.
   */
  allowedDevOnly?: Persona[];
  /**
   * Runs as admin before the persona attempts the case, and hands `run` the draft
   * version it produced. Every draft it opens therefore belongs to SOMEONE ELSE,
   * which is the condition the discard and advance rules turn on.
   */
  setup?: () => Promise<number>;
  run: (version: number) => Promise<{ status: number }>;
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
    // Footprint is production, so nobody limited to dev may create it.
    allowedDevOnly: [],
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
    // A defaultValue change lands in every enabled environment, production
    // included, so a dev-limited editor cannot make it.
    allowedDevOnly: [],
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
    // Environment flips ride the v2 update BODY separately from the gated field
    // list, so a handler-level publish check never sees them — the landing gate
    // must derive its footprint from the merge result itself.
    name: "toggle an environment via the update body (v2)",
    // Direct-update semantics, same as "land a change directly": the update
    // body authors content AND lands it, so it takes both atoms — publish
    // alone toggles via the dedicated /toggle endpoint instead.
    allowed: ["editor", "full"],
    // The flip lands in production, out of a dev-limited persona's reach.
    allowedDevOnly: [],
    run: () =>
      api.post(`/api/v2/features/${FEATURE_ID}`, {
        environments: { production: { enabled: false } },
      }),
  },
  {
    // Payload-AFFECTING metadata is a live write even though it's "metadata":
    // targeting scope changes which projects the flag serves.
    name: "update targeting metadata (v2 update)",
    allowed: ["editor", "full"],
    allowedDevOnly: [],
    run: () =>
      api.post(`/api/v2/features/${FEATURE_ID}`, {
        targetingAllProjects: true,
      }),
  },
  {
    name: "toggle an environment",
    allowed: ["publisher", "creatorPublisher", "editor", "full"],
    run: () =>
      api.post(`/api/v1/features/${FEATURE_ID}/toggle`, {
        environments: { dev: false },
      }),
  },
  {
    // The comment atom is org-wide and belongs to no family, so `commenter` holds
    // nothing else — and this is the only case it may pass. Feature Flags run their
    // own revision system, and this row is what keeps its answer equal to the one
    // permission-matrix-revision-entities asserts for the other three.
    name: "comment on a draft",
    allowed: ["commenter", "drafter", "reviewer", "editor", "full"],
    setup: seedDraft,
    run: (v) =>
      api.post(`/api/v2/features/${FEATURE_ID}/revisions/${v}/submit-review`, {
        action: "comment",
        comment: "Matrix comment",
      }),
  },
  {
    // Staging the archive alone is delete-class, so the delete atom opens its own
    // draft for it — the same directional rule `canStageArchiveDraft` states.
    name: "stage an archive in a new draft",
    allowed: ["drafter", "deleter", "editor", "full"],
    run: () =>
      api.put(`/api/v2/features/${FEATURE_ID}/revisions/new/archive`, {
        archived: true,
      }),
  },
  {
    // A narrow atom may ADVANCE an archive-only draft it did not write, because it
    // could publish that draft either way. Paired with the discard row below, which
    // is the same draft and the same personas one verb apart.
    name: "request review on an archive-only draft",
    allowed: ["drafter", "deleter", "editor", "full"],
    setup: seedArchiveDraft,
    run: (v) =>
      api.post(`/api/v2/features/${FEATURE_ID}/revisions/${v}/request-review`),
  },
  {
    // ...and may NOT destroy it: discarding is draft authority or authorship,
    // whatever the draft contains.
    name: "discard an archive-only draft",
    allowed: ["drafter", "editor", "full"],
    setup: seedArchiveDraft,
    run: (v) =>
      api.post(`/api/v2/features/${FEATURE_ID}/revisions/${v}/discard`),
  },
];

/**
 * Carry the body into the assertion: a 400 from a malformed request would
 * otherwise look like a permission result and make the case vacuous. Allowed
 * personas must actually succeed, not merely avoid a 403.
 */
function expectVerdict(
  res: { status: number; body?: unknown },
  isAllowed: boolean,
): void {
  const actual = `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 200)}`;
  if (isAllowed) {
    expect(actual).toMatch(/^[123]\d\d /);
  } else {
    expect(actual).toMatch(/^403 /);
  }
}

describe("permission matrix — Feature Flags", () => {
  beforeEach(async () => {
    await seedFeature();
  });

  describe.each(CASES)("$name", ({ allowed, allowedDevOnly, setup, run }) => {
    it.each(PERSONA_IDS)("%s", async (persona) => {
      const version = setup ? await setup() : 0;
      as(persona);
      const res = (await run(version)) as { status: number; body?: unknown };
      expectVerdict(res, allowed.includes(persona));
    });

    // The same case as a twin restricted to `dev`. Without this dimension an
    // environment-scoped atom is only ever asked the project question.
    it.each(PERSONA_IDS)("%s, limited to dev", async (persona) => {
      const version = setup ? await setup() : 0;
      as(persona, true);
      const res = (await run(version)) as { status: number; body?: unknown };
      expectVerdict(res, (allowedDevOnly ?? allowed).includes(persona));
    });
  });
});
