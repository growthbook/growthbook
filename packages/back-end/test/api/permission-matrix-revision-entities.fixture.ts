import request from "supertest";
import type { OrganizationInterface } from "shared/types/organization";
import { setupApp } from "./api.setup";
import {
  buildOrg,
  makePersonaContext,
  OPERATION_ORACLE,
  PERSONA_IDS,
  Persona,
} from "./permission-personas.fixture";

/**
 * Persona x action matrix for the three revision entities that sit on
 * BaseModel: Configs, Constants and Saved Groups.
 *
 * They share one table because they must answer the same way — Configs and
 * Constants share the "flags" atoms with Feature Flags, and Saved Groups hold
 * the mirrored SavedGroup* set. The expectations below therefore track
 * permission-matrix-features.test.ts, and a divergence is either a deliberate
 * difference or a bug.
 *
 * One entity per spec file: Jest never splits a single file across workers.
 * Importing this module boots an app and an in-memory Mongo of its own.
 */

const org: OrganizationInterface = buildOrg("org_perm_matrix_entities");
const { app, setReqContext } = setupApp();

let seq = 0;
const uniq = (p: string) => `${p}_${++seq}`;

export function as(persona: Persona | "admin", envLimited = false) {
  const role =
    persona === "admin" ? "admin" : envLimited ? `${persona}_dev` : persona;
  const userId = persona === "admin" ? "u_admin" : `u_${role}`;
  setReqContext(makePersonaContext(org, role, userId));
}

export const api = {
  post: (path: string, body: Record<string, unknown> = {}) =>
    request(app).post(path).send(body).set("Authorization", "Bearer x"),
  put: (path: string, body: Record<string, unknown> = {}) =>
    request(app).put(path).send(body).set("Authorization", "Bearer x"),
};

export type Entity = {
  label: string;
  /** Collection segment, e.g. "constants" -> /constants, /constants-revisions. */
  base: string;
  /** Body for a brand-new entity, keyed however that entity identifies itself. */
  createBody: () => Record<string, unknown>;
  /** Pull the id/key that later paths address the entity by. */
  idOf: (body: Record<string, unknown>) => string;
  /** Field-edit path segment + body on a draft revision. */
  editSegment: string;
  editBody: Record<string, unknown>;
  /** A second, different edit — lets two published revisions differ. */
  editBody2: Record<string, unknown>;
  /** A direct write to the live entity that isn't an archive. */
  renameBody: Record<string, unknown>;
};

export const CONSTANT_ENTITY: Entity = {
  label: "Constants",
  base: "constants",
  createBody: () => ({
    key: uniq("const"),
    name: "Matrix Constant",
    type: "json",
    value: '{"timeout":30}',
  }),
  idOf: (b) => b.key as string,
  editSegment: "value",
  editBody: { value: '{"timeout":45}' },
  editBody2: { value: '{"timeout":60}' },
  renameBody: { name: "Renamed" },
};

export const CONFIG_ENTITY: Entity = {
  label: "Configs",
  base: "configs",
  createBody: () => ({
    key: uniq("config"),
    name: "Matrix Config",
    value: { timeout: 30 },
  }),
  idOf: (b) => b.key as string,
  editSegment: "value",
  editBody: { value: { timeout: 45 } },
  editBody2: { value: { timeout: 60 } },
  renameBody: { name: "Renamed" },
};

export const SAVED_GROUP_ENTITY: Entity = {
  label: "Saved Groups",
  base: "saved-groups",
  createBody: () => ({
    name: uniq("group"),
    values: ["u1", "u2"],
    attributeKey: "userId",
    owner: "",
  }),
  // Saved groups are addressed by generated id, filled in after the seed.
  idOf: (b) => b.id as string,
  editSegment: "values",
  editBody: { values: ["u1", "u2", "u3"] },
  editBody2: { values: ["u1", "u2", "u3", "u4"] },
  renameBody: { name: "Renamed" },
};

type Case = {
  name: string;
  allowed: Persona[];
  // Every seeding/behavior flag the table uses MUST be declared here: the test
  // files sit outside tsc, so an undeclared (or typo'd) flag is silently
  // ignored and quietly vacates the case it was supposed to arm.
  envScopedAtom?: boolean;
  // Dev-limited expectations when they differ from `allowed`, resolved per
  // entity — the three entities' footprints are not uniform (a Constant's
  // archive reaches every environment its base value feeds; a Saved Group has
  // no environment partition at all).
  allowedDevOnly?: (e: Entity) => Persona[];
  needsEdit?: boolean;
  needsReviewRequest?: boolean;
  needsDraft?: boolean;
  needsPriorPublished?: boolean;
  needsStaleBase?: boolean;
  /** Take the live entity out of service first, so the case acts on an archived one. */
  needsArchived?: boolean;
  /** Discard the draft first, so the case acts on a discarded revision. */
  needsDiscarded?: boolean;
  /** Stage an archive into the draft, so its only proposed change is the flip. */
  needsArchiveDraft?: boolean;
  run: (
    e: Entity,
    id: string,
    version: number,
  ) => Promise<{ status: number; body?: unknown }>;
};

/**
 * Archiving and unarchiving both reach every environment the entity serves, so an
 * env-limited persona is refused — unless the entity has no environment partition
 * at all, which is only Saved Groups. An empty footprint would SKIP the check
 * rather than narrow it, so these rows are where that mistake shows up.
 */
const servesEveryEnvironment = (op: string) => (e: Entity) =>
  e.label === "Saved Groups" ? OPERATION_ORACLE[op] : [];

const CASES: Case[] = [
  {
    // None of these three reach an SDK payload until something references them,
    // so bringing one into being takes only create authority.
    name: "create",
    envScopedAtom: true,
    allowed: OPERATION_ORACLE["create"],
    run: (e) => api.post(`/api/v1/${e.base}`, e.createBody()),
  },
  {
    name: "open a draft",
    allowed: OPERATION_ORACLE["open a draft"],
    run: (e, id) => api.post(`/api/v1/${e.base}-revisions/${id}`, {}),
  },
  {
    name: "edit a draft opened by someone else",
    allowed: OPERATION_ORACLE["edit a draft opened by someone else"],
    needsDraft: true,
    run: (e, id, v) =>
      api.put(
        `/api/v1/${e.base}-revisions/${id}/${v}/${e.editSegment}`,
        e.editBody,
      ),
  },
  {
    name: "request review on a draft",
    allowed: OPERATION_ORACLE["request review on a draft"],
    needsDraft: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/request-review`, {}),
  },
  {
    name: "land a change directly",
    envScopedAtom: true,
    allowed: OPERATION_ORACLE["land a change directly"],
    run: (e, id) => api.post(`/api/v1/${e.base}/${id}`, e.renameBody),
  },
  {
    name: "archive",
    envScopedAtom: true,
    allowed: OPERATION_ORACLE["archive"],
    // Archiving takes the entity out of EVERY environment it serves, so the
    // delete atom must hold in all of them and a dev-limited deleter is refused.
    // True of a Constant via its base value and of the BASE Config seeded here,
    // which names no scoped environments and so feeds them all.
    allowedDevOnly: servesEveryEnvironment("archive"),
    run: (e, id) => api.post(`/api/v1/${e.base}/${id}/archive`, {}),
  },
  {
    name: "publish a draft",
    envScopedAtom: true,
    allowed: OPERATION_ORACLE["publish a draft"],
    needsEdit: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/publish`, {}),
  },
  {
    name: "submit a review verdict",
    allowed: OPERATION_ORACLE["submit a review verdict"],
    needsReviewRequest: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/submit-review`, {
        decision: "approve",
      }),
  },
  {
    name: "discard a draft",
    allowed: OPERATION_ORACLE["discard a draft"],
    needsEdit: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/discard`, {}),
  },
  {
    // Rebasing pulls the live change in, so only draft authority reaches it. A
    // reverter or deleter must be refused: otherwise "rebase before publishing"
    // becomes a way to sweep someone else's work into a draft the narrow atom is
    // allowed to land. The no-op half of that rule is unit-tested.
    name: "rebase a draft whose base has moved",
    allowed: OPERATION_ORACLE["rebase a draft whose base has moved"],
    needsStaleBase: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/rebase`, {
        conflictResolutions: {},
      }),
  },
  {
    // Staging a revert publishes nothing, so draft authority reaches it — and so
    // does revert authority on its own, which is the point of the atom.
    name: "stage a revert as a draft",
    allowed: OPERATION_ORACLE["stage a revert as a draft"],
    needsPriorPublished: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/revert`, {
        strategy: "draft",
      }),
  },
  {
    // Landing one is the only case that asserts what a reverter MAY put in front
    // of users. Every other case asserts it is refused, so the atom would look
    // correct even if it granted nothing at all.
    //
    // Publish authority is NOT enough, even though a publisher could reach the
    // same end state by drafting the old values: under `revertsBypassApproval` a
    // revert can skip review, so it is its own capability rather than a weaker
    // publish.
    name: "revert straight to published",
    allowed: OPERATION_ORACLE["revert straight to published"],
    needsPriorPublished: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/revert`, {
        strategy: "publish",
      }),
  },
  {
    // The way back is an ordinary publish, so the delete atom that archived the
    // entity does not reach it. Held next to `archive`, which is the same round
    // trip in the other direction: a deleter passing both would own the toggle.
    name: "unarchive",
    envScopedAtom: true,
    allowed: OPERATION_ORACLE["unarchive"],
    allowedDevOnly: servesEveryEnvironment("unarchive"),
    needsArchived: true,
    run: (e, id) => api.post(`/api/v1/${e.base}/${id}/unarchive`, {}),
  },
  {
    // A comment is participation, so it is the one thing the comment atom alone
    // reaches — and the only case a persona holding no family policy may pass.
    // Submitted on a plain draft, not a review request: commenting carries no
    // status requirement, and seeding one would have let the review path's own
    // gate stand in for this check.
    name: "comment on a draft",
    allowed: OPERATION_ORACLE["comment on a draft"],
    needsDraft: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/submit-review`, {
        decision: "comment",
        comment: "Matrix comment",
      }),
  },
  {
    // `version: "new"` on purpose: the delete atom opens its OWN draft, and this
    // asks for it project-scoped rather than over the environment footprint
    // `archive` demands. Seeding a draft here would have measured the sideways
    // rule below instead, and the deleter would look refused for the wrong reason.
    name: "stage an archive in a new draft",
    allowed: OPERATION_ORACLE["stage an archive in a new draft"],
    run: (e, id) =>
      api.put(`/api/v1/${e.base}-revisions/${id}/new/archive`, {
        archived: true,
      }),
  },
  {
    // Same endpoint, same fresh draft, opposite direction — so the only thing
    // that can refuse the deleter here is the direction itself.
    name: "stage an unarchive in a new draft",
    allowed: OPERATION_ORACLE["stage an unarchive in a new draft"],
    needsArchived: true,
    run: (e, id) =>
      api.put(`/api/v1/${e.base}-revisions/${id}/new/archive`, {
        archived: false,
      }),
  },
  {
    // The sideways reach: an admin's draft, and the archiving direction the
    // deleter is otherwise allowed to stage. It must still be refused, because
    // the objection is whose draft it is rather than which way it flips.
    name: "stage an archive into another author's draft",
    allowed: OPERATION_ORACLE["stage an archive into another author's draft"],
    needsDraft: true,
    run: (e, id, v) =>
      api.put(`/api/v1/${e.base}-revisions/${id}/${v}/archive`, {
        archived: true,
      }),
  },
  {
    // The positive half of the discard rule below: a narrow atom may still move
    // an archive-only draft along, so the deleter here is ALLOWED. Without this
    // row, deleting the pure-archive branch outright would look like a fix.
    name: "request review on an archive-only draft",
    allowed: OPERATION_ORACLE["request review on an archive-only draft"],
    needsArchiveDraft: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/request-review`, {}),
  },
  {
    // ...and the negative half. Same draft, same personas, one verb apart: the
    // deleter that may advance this draft may not throw it away, because it is
    // the admin's work. `discard a draft` stages a value edit, which refuses a
    // deleter for the ordinary reason and so cannot distinguish the two rules.
    name: "discard an archive-only draft",
    allowed: OPERATION_ORACLE["discard an archive-only draft"],
    needsArchiveDraft: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/discard`, {}),
  },
  {
    // The lifecycle verbs. All three entities share one implementation; these
    // rows hold them to it.
    name: "recall a review request",
    allowed: OPERATION_ORACLE["recall a review request"],
    needsReviewRequest: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/recall-review`, {}),
  },
  {
    name: "reopen a discarded revision",
    allowed: OPERATION_ORACLE["reopen a discarded revision"],
    needsDiscarded: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/reopen`, {}),
  },
  {
    // The persona must cast its own verdict before retracting it.
    name: "retract your own review verdict",
    allowed: OPERATION_ORACLE["retract your own review verdict"],
    needsReviewRequest: true,
    run: async (e, id, v) => {
      await api.post(`/api/v1/${e.base}-revisions/${id}/${v}/submit-review`, {
        decision: "approve",
      });
      return api.post(`/api/v1/${e.base}-revisions/${id}/${v}/undo-review`, {});
    },
  },
  {
    // Arming commits a future publish, so it asks the publish question — but
    // project-scoped here, since the seeded entities name no scoped environments.
    name: "schedule a deferred publish",
    allowed: OPERATION_ORACLE["schedule a deferred publish"],
    needsEdit: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/schedule-publish`, {
        scheduledPublishAt: new Date(Date.now() + 86400000).toISOString(),
      }),
  },
];

/** A fresh entity per case, so no case can be affected by an earlier one. */
export async function seed(e: Entity): Promise<string> {
  as("admin");
  const body = e.createBody();
  const res = await api.post(`/api/v1/${e.base}`, body);
  if (res.status >= 400) {
    throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  // Key-addressed entities echo the key back; id-addressed ones mint one.
  const created = (res.body ?? {}) as Record<string, Record<string, unknown>>;
  const doc =
    created[e.base.replace(/s$/, "").replace("-", "")] ??
    created.savedGroup ??
    created.config ??
    created.constant ??
    {};
  return e.idOf({ ...body, ...doc });
}

/** Give the draft content, so publishing it is not a no-op. */
async function seedEdit(
  e: Entity,
  id: string,
  version: number,
  body: Record<string, unknown> = e.editBody,
): Promise<void> {
  as("admin");
  const res = await api.put(
    `/api/v1/${e.base}-revisions/${id}/${version}/${e.editSegment}`,
    body,
  );
  if (res.status >= 400) {
    throw new Error(
      `edit seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * Publish two differing revisions as admin and return the FIRST one's version,
 * so reverting to it restores a state the entity no longer has.
 */
async function seedPriorPublishedRevision(
  e: Entity,
  id: string,
): Promise<number> {
  const version = await seedDraft(e, id);
  await seedEdit(e, id, version, e.editBody);
  await seedPublish(e, id, version);
  // Move the live state off that revision with a direct write, so reverting to
  // it restores something the entity no longer has. Cheaper than publishing a
  // second revision, and it changes the same field the revert compares.
  as("admin");
  const res = await api.post(`/api/v1/${e.base}/${id}`, e.editBody2);
  if (res.status >= 400) {
    throw new Error(
      `live-move seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return version;
}

async function seedPublish(
  e: Entity,
  id: string,
  version: number,
): Promise<void> {
  as("admin");
  const res = await api.post(
    `/api/v1/${e.base}-revisions/${id}/${version}/publish`,
    {},
  );
  if (res.status >= 400) {
    throw new Error(
      `publish seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * Leave the draft's base behind: edit the draft, then move the live state with a
 * direct write. Rebasing now pulls that live change in, which is what a narrow
 * atom must not be able to do.
 */
async function seedStaleBase(e: Entity, id: string, version: number) {
  await seedEdit(e, id, version, e.editBody);
  as("admin");
  const res = await api.post(`/api/v1/${e.base}/${id}`, e.renameBody);
  if (res.status >= 400) {
    throw new Error(
      `stale-base seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * A pure-revert draft standing on the current live state, so rebasing it pulls
 * nothing in. Returns the draft's version.
 */
export async function seedRevertDraft(e: Entity, id: string): Promise<number> {
  const target = await seedPriorPublishedRevision(e, id);
  as("admin");
  const res = await api.post(
    `/api/v1/${e.base}-revisions/${id}/${target}/revert`,
    { strategy: "draft" },
  );
  if (res.status >= 400) {
    throw new Error(
      `revert-draft seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as { revision?: { version?: number } };
  const version = body.revision?.version;
  if (!version) {
    throw new Error(
      `revert-draft seed returned no version: ${JSON.stringify(res.body)}`,
    );
  }
  return version;
}

/** Move the draft to pending-review, so a verdict can be submitted on it. */
async function seedReviewRequest(
  e: Entity,
  id: string,
  version: number,
): Promise<void> {
  as("admin");
  const res = await api.post(
    `/api/v1/${e.base}-revisions/${id}/${version}/request-review`,
    {},
  );
  if (res.status >= 400) {
    throw new Error(
      `review-request seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/** Take the entity out of service, so the case acts on an archived one. */
async function seedArchived(e: Entity, id: string): Promise<void> {
  as("admin");
  const res = await api.post(`/api/v1/${e.base}/${id}/archive`, {});
  if (res.status >= 400) {
    throw new Error(
      `archive seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * A draft whose ONLY proposed change is the archive flip — the shape a narrow
 * atom is allowed to advance. Seeded as admin, so the persona under test is never
 * its author and authorship cannot stand in for the atom.
 */
async function seedArchiveDraft(
  e: Entity,
  id: string,
  version: number,
): Promise<void> {
  as("admin");
  const res = await api.put(
    `/api/v1/${e.base}-revisions/${id}/${version}/archive`,
    { archived: true },
  );
  if (res.status >= 400) {
    throw new Error(
      `archive-draft seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/** Throw the draft away, so the case acts on a discarded revision. */
async function seedDiscarded(
  e: Entity,
  id: string,
  version: number,
): Promise<void> {
  as("admin");
  const res = await api.post(
    `/api/v1/${e.base}-revisions/${id}/${version}/discard`,
    {},
  );
  if (res.status >= 400) {
    throw new Error(
      `discard seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

async function seedDraft(e: Entity, id: string): Promise<number> {
  as("admin");
  const res = await api.post(`/api/v1/${e.base}-revisions/${id}`, {});
  if (res.status >= 400) {
    throw new Error(
      `draft seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as {
    revision?: { version?: number };
    version?: number;
  };
  return body.revision?.version ?? body.version ?? 1;
}

/**
 * Carry the body into the assertion: a 400 from a malformed request would
 * otherwise look like a permission result and make the case vacuous.
 */
export function expectVerdict(
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

export function describeEntityMatrix(entity: Entity): void {
  describe.each(CASES)(
    `permission matrix — ${entity.label} — $name`,
    ({
      allowed,
      run,
      needsDraft,
      needsEdit,
      needsReviewRequest,
      needsPriorPublished,
      needsStaleBase,
      needsArchived,
      needsArchiveDraft,
      needsDiscarded,
      envScopedAtom,
      allowedDevOnly,
    }: Case) => {
      const attempt = async (persona: Persona, envLimited: boolean) => {
        const expected =
          envLimited && allowedDevOnly ? allowedDevOnly(entity) : allowed;
        const id = await seed(entity);
        if (needsArchived) {
          await seedArchived(entity, id);
        }
        if (needsPriorPublished) {
          const target = await seedPriorPublishedRevision(entity, id);
          as(persona, envLimited);
          const priorRes = await run(entity, id, target);
          expectVerdict(priorRes, expected.includes(persona));
          return;
        }
        const wantsDraft =
          needsDraft ||
          needsEdit ||
          needsReviewRequest ||
          needsStaleBase ||
          needsArchiveDraft ||
          needsDiscarded;
        const version = wantsDraft ? await seedDraft(entity, id) : 0;
        if (needsArchiveDraft) {
          await seedArchiveDraft(entity, id, version);
        }
        if (needsEdit || needsReviewRequest) {
          await seedEdit(entity, id, version);
        }
        if (needsStaleBase) {
          await seedStaleBase(entity, id, version);
        }
        if (needsReviewRequest) {
          await seedReviewRequest(entity, id, version);
        }
        if (needsDiscarded) {
          await seedDiscarded(entity, id, version);
        }

        as(persona, envLimited);
        const res = await run(entity, id, version);
        expectVerdict(res, expected.includes(persona));
      };

      it.each(PERSONA_IDS)("%s", (persona) => attempt(persona, false));

      // For most cases an environment restriction must not bite: the footprint
      // is empty and the verdict unchanged, so acquiring one would be the bug.
      // Cases where an entity's footprint genuinely differs (a Constant's
      // archive) declare it via `allowedDevOnly`. Left
      // off the revert cases on purpose — staging publishes nothing, so the
      // restriction is inapplicable rather than inert, and landing pins the same
      // empty footprint `publish a draft` covers for a third of the round trips.
      if (envScopedAtom) {
        it.each(PERSONA_IDS)("%s, limited to dev", (persona) =>
          attempt(persona, true),
        );
      }
    },
  );
}
