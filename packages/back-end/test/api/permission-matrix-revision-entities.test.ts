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
 * Persona x action matrix for the three revision entities that sit on
 * BaseModel: Configs, Constants and Saved Groups.
 *
 * They are table-driven together because they must answer the same way —
 * Configs and Constants share the "flags" atoms with Feature Flags, and Saved
 * Groups hold the mirrored SavedGroup* set. The expectations below therefore
 * track permission-matrix-features.test.ts, and a divergence is either a
 * deliberate difference or a bug.
 *
 * These caught three: an entity `canUpdate` that demanded publish for an
 * archive, a revision backstop that demanded publish for a draft edit, and
 * model-layer denials surfacing as 400 instead of 403.
 */

const org: OrganizationInterface = buildOrg("org_perm_matrix_entities");
const { app, setReqContext } = setupApp();

let seq = 0;
const uniq = (p: string) => `${p}_${++seq}`;

function as(persona: Persona | "admin") {
  const userId = persona === "admin" ? "u_admin" : `u_${persona}`;
  setReqContext(makePersonaContext(org, persona, userId));
}

const api = {
  post: (path: string, body: Record<string, unknown> = {}) =>
    request(app).post(path).send(body).set("Authorization", "Bearer x"),
  put: (path: string, body: Record<string, unknown> = {}) =>
    request(app).put(path).send(body).set("Authorization", "Bearer x"),
};

type Entity = {
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

const ENTITIES: Entity[] = [
  {
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
  },
  {
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
  },
  {
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
  },
];

type Case = {
  name: string;
  allowed: Persona[];
  needsEdit?: boolean;
  needsReviewRequest?: boolean;
  run: (
    e: Entity,
    id: string,
    version: number,
  ) => Promise<{ status: number; body?: unknown }>;
  needsDraft?: boolean;
};

const CASES: Case[] = [
  {
    // None of these three reach an SDK payload until something references them,
    // so bringing one into being takes only create authority.
    name: "create",
    allowed: ["creator", "creatorPublisher", "full"],
    run: (e) => api.post(`/api/v1/${e.base}`, e.createBody()),
  },
  {
    name: "open a draft",
    allowed: ["drafter", "editor", "full"],
    run: (e, id) => api.post(`/api/v1/${e.base}-revisions/${id}`, {}),
  },
  {
    name: "edit a draft opened by someone else",
    allowed: ["drafter", "editor", "full"],
    needsDraft: true,
    run: (e, id, v) =>
      api.put(
        `/api/v1/${e.base}-revisions/${id}/${v}/${e.editSegment}`,
        e.editBody,
      ),
  },
  {
    name: "request review on a draft",
    allowed: ["drafter", "editor", "full"],
    needsDraft: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/request-review`, {}),
  },
  {
    name: "land a change directly",
    allowed: ["editor", "full"],
    run: (e, id) => api.post(`/api/v1/${e.base}/${id}`, e.renameBody),
  },
  {
    name: "archive",
    allowed: ["deleter", "full"],
    run: (e, id) => api.post(`/api/v1/${e.base}/${id}/archive`, {}),
  },
  {
    name: "publish a draft",
    allowed: ["publisher", "creatorPublisher", "editor", "full"],
    needsEdit: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/publish`, {}),
  },
  {
    name: "submit a review verdict",
    allowed: ["reviewer", "full"],
    needsReviewRequest: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/submit-review`, {
        decision: "approve",
      }),
  },
  {
    name: "discard a draft",
    allowed: ["drafter", "editor", "full"],
    needsEdit: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/discard`, {}),
  },
  {
    // Staging a revert publishes nothing, so draft authority reaches it — and so
    // does revert authority on its own, which is the point of the atom.
    name: "stage a revert as a draft",
    allowed: ["drafter", "reverter", "editor", "full"],
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
    allowed: ["reverter", "full"],
    needsPriorPublished: true,
    run: (e, id, v) =>
      api.post(`/api/v1/${e.base}-revisions/${id}/${v}/revert`, {
        strategy: "publish",
      }),
  },
];

/** A fresh entity per case, so no case can be affected by an earlier one. */
async function seed(e: Entity): Promise<string> {
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

describe.each(ENTITIES)("permission matrix — $label", (entity: Entity) => {
  describe.each(CASES)(
    "$name",
    ({
      allowed,
      run,
      needsDraft,
      needsEdit,
      needsReviewRequest,
      needsPriorPublished,
    }: Case) => {
      it.each(PERSONA_IDS)("%s", async (persona) => {
        const id = await seed(entity);
        if (needsPriorPublished) {
          const target = await seedPriorPublishedRevision(entity, id);
          as(persona);
          const priorRes = await run(entity, id, target);
          expectVerdict(priorRes, allowed.includes(persona));
          return;
        }
        const wantsDraft = needsDraft || needsEdit || needsReviewRequest;
        const version = wantsDraft ? await seedDraft(entity, id) : 0;
        if (needsEdit || needsReviewRequest) {
          await seedEdit(entity, id, version);
        }
        if (needsReviewRequest) {
          await seedReviewRequest(entity, id, version);
        }

        as(persona);
        const res = await run(entity, id, version);
        // Carry the body into the assertion: a 400 from a malformed request would
        // otherwise look like a permission result and make the case vacuous.
        const actual = `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 200)}`;

        if (allowed.includes(persona)) {
          expect(actual).toMatch(/^[123]\d\d /);
        } else {
          expect(actual).toMatch(/^403 /);
        }
      });
    },
  );
});
