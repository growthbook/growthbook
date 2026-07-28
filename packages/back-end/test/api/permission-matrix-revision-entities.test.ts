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
    renameBody: { name: "Renamed" },
  },
];

type Case = {
  name: string;
  allowed: Persona[];
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

describe.each(ENTITIES)("permission matrix — $label", (entity: Entity) => {
  describe.each(CASES)("$name", ({ allowed, run, needsDraft }: Case) => {
    it.each(PERSONA_IDS)("%s", async (persona) => {
      const id = await seed(entity);
      const version = needsDraft ? await seedDraft(entity, id) : 0;

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
  });
});
