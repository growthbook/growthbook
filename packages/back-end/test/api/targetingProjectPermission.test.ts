import mongoose from "mongoose";
import request from "supertest";
import type { OrganizationInterface } from "shared/types/organization";
import { setupApp } from "./api.setup";
import { makePersonaContext } from "./permission-personas.fixture";

/**
 * Targeting Projects through the real REST handlers, with PROJECT-SCOPED roles:
 * the case the persona matrix cannot express. Adding a targeting project takes
 * `targetFeatures` in that project; "all projects" takes it unscoped; removing
 * one takes nothing extra.
 */

const ENVS = ["dev", "production"];
const { app, setReqContext } = setupApp();

const org = {
  id: "org_targeting_permission",
  name: "Targeting Permission",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  customRoles: [
    {
      id: "flag_editor",
      description: "",
      policies: [
        "ReadData",
        "FlagsCreate",
        "FlagsEditDrafts",
        "FlagsPublish",
        "FlagsRevert",
      ],
    },
    {
      id: "flag_target",
      description: "",
      policies: ["ReadData", "FlagsTarget"],
    },
    {
      id: "flag_reviewer",
      description: "",
      policies: ["ReadData", "FlagsReview"],
    },
  ],
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    {
      id: "u_global_full",
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: ENVS.map((id) => ({ id, description: "" })) },
} as unknown as OrganizationInterface;

const api = {
  post: (path: string, body: Record<string, unknown> = {}) =>
    request(app).post(path).send(body).set("Authorization", "Bearer x"),
  put: (path: string, body: Record<string, unknown> = {}) =>
    request(app).put(path).send(body).set("Authorization", "Bearer x"),
  get: (path: string) =>
    request(app).get(path).set("Authorization", "Bearer x"),
};

function as(userId: string) {
  const member = org.members.find((m) => m.id === userId);
  if (!member) throw new Error(`unknown member ${userId}`);
  setReqContext(makePersonaContext(org, member.role, userId));
}

const projectRole = (project: string, role: string) => ({
  project,
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

let prjA = "";
let prjB = "";
let prjC = "";
let seq = 0;

async function createProject(name: string): Promise<string> {
  as("u_admin");
  const res = await api.post("/api/v1/projects", { name });
  if (res.status >= 400) {
    throw new Error(
      `project seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return (res.body as { project: { id: string } }).project.id;
}

async function seedFeature(targetingProjects: string[] = []): Promise<string> {
  as("u_admin");
  const id = `feat_tp_${Date.now()}_${seq++}`;
  const res = await api.post("/api/v1/features", {
    id,
    valueType: "boolean",
    defaultValue: "false",
    owner: "u_admin",
    project: prjB,
    targetingProjects,
  });
  if (res.status >= 400) {
    throw new Error(
      `feature seed failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return id;
}

beforeAll(async () => {
  prjA = await createProject("Project A");
  prjB = await createProject("Project B");
  prjC = await createProject("Project C");
  org.members.push(
    // Edits and publishes in B; may not deliver into A.
    {
      id: "u_b_editor",
      role: "noaccess",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [projectRole(prjB, "flag_editor")],
    },
    // Reads B's flags; reviews only in C, which has an approval rule of its own.
    {
      id: "u_c_reviewer",
      role: "noaccess",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [
        projectRole(prjB, "readonly"),
        projectRole(prjC, "flag_reviewer"),
      ],
    },
    // The "Team 5" grant: B's editor who may also target A.
    {
      id: "u_b_editor_targets_a",
      role: "noaccess",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [
        projectRole(prjB, "flag_editor"),
        projectRole(prjA, "flag_target"),
      ],
    },
  );
});

describe("adding a targeting project", () => {
  it.each([
    ["u_b_editor", 403],
    ["u_b_editor_targets_a", 200],
  ])("%s → %i on a v1 update", async (userId, status) => {
    const id = await seedFeature();
    as(userId);
    const res = await api.post(`/api/v1/features/${id}`, {
      targetingProjects: [prjA],
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ["u_b_editor", 403],
    ["u_b_editor_targets_a", 200],
  ])("%s → %i on a v2 update", async (userId, status) => {
    const id = await seedFeature();
    as(userId);
    const res = await api.post(`/api/v2/features/${id}`, {
      targetingProjects: [prjA],
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ["u_b_editor", 403],
    ["u_b_editor_targets_a", 200],
  ])("%s → %i on create", async (userId, status) => {
    as(userId);
    const res = await api.post("/api/v1/features", {
      id: `feat_tp_create_${Date.now()}_${seq++}`,
      valueType: "boolean",
      defaultValue: "false",
      owner: "u_admin",
      project: prjB,
      targetingProjects: [prjA],
    });
    expect(res.status).toBe(status);
  });
});

describe("all projects", () => {
  // Reaches projects that do not exist yet, so a project-scoped grant is not enough.
  it.each([
    ["u_b_editor_targets_a", 403],
    ["u_global_full", 200],
  ])("%s → %i", async (userId, status) => {
    const id = await seedFeature();
    as(userId);
    const res = await api.post(`/api/v1/features/${id}`, {
      targetingAllProjects: true,
    });
    expect(res.status).toBe(status);
  });
});

describe("landing a draft that stages a targeting project", () => {
  it("takes the atom from whoever publishes, and echoes are free", async () => {
    const id = await seedFeature();
    as("u_b_editor_targets_a");
    const staged = await api.put(
      `/api/v2/features/${id}/revisions/new/metadata`,
      { targetingProjects: [prjA] },
    );
    expect(staged.status).toBe(200);
    const version = (staged.body as { revision: { version: number } }).revision
      .version;

    // A colleague without Target in A may keep working on the draft, echoing
    // its staged targeting, but may not land it.
    as("u_b_editor");
    const echoed = await api.put(
      `/api/v2/features/${id}/revisions/${version}/metadata`,
      { targetingProjects: [prjA], description: "still staging A" },
    );
    expect(echoed.status).toBe(200);
    const refused = await api.post(
      `/api/v1/features/${id}/revisions/${version}/publish`,
      {},
    );
    expect(refused.status).toBe(403);
    expect((refused.body as { message: string }).message).toMatch(/target/i);

    as("u_b_editor_targets_a");
    const landed = await api.post(
      `/api/v1/features/${id}/revisions/${version}/publish`,
      {},
    );
    expect(landed.status).toBe(200);
  });
});

describe("putting back what a draft removed", () => {
  it("takes nothing, even after live moved on without it", async () => {
    const id = await seedFeature([prjA]);
    as("u_b_editor");
    const dropped = await api.put(
      `/api/v2/features/${id}/revisions/new/metadata`,
      { targetingProjects: [] },
    );
    expect(dropped.status).toBe(200);
    const version = (dropped.body as { revision: { version: number } }).revision
      .version;

    as("u_admin");
    const drifted = await api.post(`/api/v1/features/${id}`, {
      targetingProjects: [],
    });
    expect(drifted.status).toBe(200);

    as("u_b_editor");
    const restored = await api.put(
      `/api/v2/features/${id}/revisions/${version}/metadata`,
      { targetingProjects: [prjA] },
    );
    expect(restored.status).toBe(200);
  });
});

describe("a project that does not allow targeting", () => {
  it("refuses new targeting and all-projects, but keeps existing targeting editable", async () => {
    as("u_admin");
    const created = await api.post("/api/v1/projects", { name: "Project D" });
    const prjD = (created.body as { project: { id: string } }).project.id;
    const alreadyTargeted = await seedFeature([prjD]);
    const optOut = await api.put(`/api/v1/projects/${prjD}`, {
      allowTargeting: false,
    });
    expect(optOut.status).toBe(200);

    const fresh = await seedFeature();
    as("u_global_full");
    const refused = await api.post(`/api/v1/features/${fresh}`, {
      targetingProjects: [prjD],
    });
    expect(refused.status).toBe(403);
    expect((refused.body as { message: string }).message).toMatch(
      /allow targeting/,
    );
    const all = await api.post(`/api/v1/features/${fresh}`, {
      targetingAllProjects: true,
    });
    expect(all.status).toBe(403);

    const kept = await api.post(`/api/v1/features/${alreadyTargeted}`, {
      targetingProjects: [prjD, prjA],
    });
    expect(kept.status).toBe(200);
  });
});

describe("existing targeting", () => {
  // Only the delta is judged: a project already targeted stays, whoever edits.
  it("does not block adding another project or editing", async () => {
    const id = await seedFeature([prjC]);
    as("u_b_editor_targets_a");
    const added = await api.post(`/api/v1/features/${id}`, {
      targetingProjects: [prjC, prjA],
    });
    expect(added.status).toBe(200);
    expect(
      (added.body as { feature: { targetingProjects: string[] } }).feature
        .targetingProjects,
    ).toEqual([prjC, prjA]);
    as("u_b_editor");
    const edited = await api.post(`/api/v1/features/${id}`, {
      defaultValue: "true",
    });
    expect(edited.status).toBe(200);
  });

  it("can be removed, and left alone, without the targeting atom", async () => {
    const id = await seedFeature([prjA]);
    as("u_b_editor");
    const untouched = await api.post(`/api/v1/features/${id}`, {
      description: "still targets A",
    });
    expect(untouched.status).toBe(200);
    const removed = await api.post(`/api/v1/features/${id}`, {
      targetingProjects: [],
    });
    expect(removed.status).toBe(200);
  });
});

describe("an unknown targeting project id", () => {
  it("is refused as a permission error before it is checked for existence", async () => {
    const id = await seedFeature();
    as("u_b_editor");
    const refused = await api.put(
      `/api/v2/features/${id}/revisions/new/metadata`,
      { targetingProjects: ["prj_does_not_exist"] },
    );
    expect(refused.status).toBe(403);

    as("u_admin");
    const invalid = await api.put(
      `/api/v2/features/${id}/revisions/new/metadata`,
      { targetingProjects: ["prj_does_not_exist"] },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain("prj_does_not_exist");
  });
});

describe("the other REST writers apply the same gate", () => {
  it("v2 create", async () => {
    const body = (id: string) => ({
      id,
      valueType: "boolean",
      defaultValue: "false",
      owner: "u_admin",
      project: prjB,
      targetingProjects: [prjA],
    });
    as("u_b_editor");
    const refused = await api.post("/api/v2/features", body(`v2c_${seq++}`));
    expect(refused.status).toBe(403);
    as("u_b_editor_targets_a");
    const created = await api.post("/api/v2/features", body(`v2c_${seq++}`));
    expect(created.status).toBe(200);
  });

  it("v1 revision metadata", async () => {
    const id = await seedFeature();
    as("u_b_editor");
    const refused = await api.put(
      `/api/v1/features/${id}/revisions/new/metadata`,
      { targetingProjects: [prjA] },
    );
    expect(refused.status).toBe(403);
    as("u_b_editor_targets_a");
    const staged = await api.put(
      `/api/v1/features/${id}/revisions/new/metadata`,
      { targetingProjects: [prjA] },
    );
    expect(staged.status).toBe(200);
  });

  it("v1 and v2 revert to a revision that targeted more", async () => {
    const id = await seedFeature([prjA]);
    as("u_admin");
    const narrowed = await api.post(`/api/v1/features/${id}`, {
      targetingProjects: [],
    });
    expect(narrowed.status).toBe(200);

    as("u_b_editor");
    for (const path of [
      `/api/v1/features/${id}/revert`,
      `/api/v2/features/${id}/revert`,
    ]) {
      const refused = await api.post(path, { revision: 1 });
      expect(refused.status).toBe(403);
      expect((refused.body as { message: string }).message).toMatch(/target/i);
    }

    as("u_b_editor_targets_a");
    const reverted = await api.post(`/api/v2/features/${id}/revert`, {
      revision: 1,
    });
    expect(reverted.status).toBe(200);
  });
});

describe("allowTargeting on the projects REST API", () => {
  it("is written on create and update, read back, and defaults to on", async () => {
    as("u_admin");
    const plain = await api.post("/api/v1/projects", { name: "Plain" });
    expect(
      (plain.body as { project: { allowTargeting: boolean } }).project
        .allowTargeting,
    ).toBe(true);

    const created = await api.post("/api/v1/projects", {
      name: "Opted out at birth",
      allowTargeting: false,
    });
    expect(created.status).toBe(200);
    const id = (created.body as { project: { id: string } }).project.id;
    expect(
      (created.body as { project: { allowTargeting: boolean } }).project
        .allowTargeting,
    ).toBe(false);

    const reopened = await api.put(`/api/v1/projects/${id}`, {
      allowTargeting: true,
    });
    expect(
      (reopened.body as { project: { allowTargeting: boolean } }).project
        .allowTargeting,
    ).toBe(true);

    // A project written before the setting existed reads as on. Native handle:
    // registering the collection with mongoose would have the harness wipe the
    // projects seeded in beforeAll after this test.
    await mongoose.connection.db.collection("projects").insertOne({
      id: "prj_legacy",
      organization: org.id,
      name: "Legacy",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const legacy = await api.get("/api/v1/projects/prj_legacy");
    expect(legacy.status).toBe(200);
    expect(
      (legacy.body as { project: { allowTargeting: boolean } }).project
        .allowTargeting,
    ).toBe(true);

    const listed = await api.get("/api/v1/projects?limit=100");
    const rows = (
      listed.body as { projects: { id: string; allowTargeting: boolean }[] }
    ).projects;
    expect(rows.find((p) => p.id === id)?.allowTargeting).toBe(true);
    expect(rows.find((p) => p.id === "prj_legacy")?.allowTargeting).toBe(true);
  });
});

describe("undoing a review", () => {
  it("is refused for a reviewer whose project the flag does not reach, even when the coarse gate admits them", async () => {
    const id = await seedFeature();
    as("u_admin");
    const staged = await api.put(
      `/api/v2/features/${id}/revisions/new/metadata`,
      { description: "under review" },
    );
    const version = (staged.body as { revision: { version: number } }).revision
      .version;

    // C has a rule of its own, so C's reviewers pass the coarse candidate
    // gate for every flag; this flag never reaches C.
    const settings = org.settings as { requireReviews?: unknown };
    settings.requireReviews = [
      {
        requireReviewOn: true,
        projects: [prjC],
        environments: [],
        requiredApproverTeams: [],
      },
    ];
    try {
      as("u_c_reviewer");
      const res = await api.post(
        `/api/v2/features/${id}/revisions/${version}/undo-review`,
        {},
      );
      expect(res.status).toBe(403);
    } finally {
      delete settings.requireReviews;
    }
  });
});
