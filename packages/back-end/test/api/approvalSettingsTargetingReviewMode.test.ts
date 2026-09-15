import request from "supertest";
import type { OrganizationInterface } from "shared/types/organization";
import { setupApp } from "./api.setup";
import { makePersonaContext } from "./permission-personas.fixture";

// `targetingReviewMode` was readable but not writable over REST; the dashboard
// only exposes the organization-wide rule, so per-project rules live here.
const { app, setReqContext } = setupApp();

const org = {
  id: "org_targeting_review_mode",
  name: "Targeting Review Mode",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  customRoles: [],
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const api = {
  get: (path: string) =>
    request(app).get(path).set("Authorization", "Bearer x"),
  post: (path: string, body: Record<string, unknown>) =>
    request(app).post(path).send(body).set("Authorization", "Bearer x"),
  put: (path: string, body: Record<string, unknown>) =>
    request(app).put(path).send(body).set("Authorization", "Bearer x"),
  delete: (path: string) =>
    request(app).delete(path).set("Authorization", "Bearer x"),
};

beforeEach(() => setReqContext(makePersonaContext(org, "admin", "u_admin")));

describe("PUT /settings/approvals targetingReviewMode", () => {
  it("stores per-project rules and reads them back", async () => {
    const created = await api.post("/api/v1/projects", { name: "Consumer" });
    const projectId = (created.body as { project: { id: string } }).project.id;

    const rules = [
      { projects: [], mode: "strict" },
      { projects: [projectId], mode: "loose" },
    ];
    const put = await api.put("/api/v1/settings/approvals", {
      targetingReviewMode: rules,
    });
    expect(put.status).toBe(200);
    expect(put.body.targetingReviewMode).toEqual(rules);

    // The handler reads the org off the request context, so refresh it.
    org.settings = { ...org.settings, targetingReviewMode: rules };
    setReqContext(makePersonaContext(org, "admin", "u_admin"));
    const got = await api.get("/api/v1/settings");
    expect(got.status).toBe(200);
    expect(got.body.settings.targetingReviewMode).toEqual(rules);
  });

  it("refuses a rule naming a project that does not exist", async () => {
    const res = await api.put("/api/v1/settings/approvals", {
      targetingReviewMode: [{ projects: ["prj_missing"], mode: "loose" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/prj_missing/);
  });

  it("leaves the mode untouched when omitted", async () => {
    const res = await api.put("/api/v1/settings/approvals", {
      requireReviews: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.targetingReviewMode).toEqual(
      org.settings?.targetingReviewMode ?? [],
    );
  });

  it("forgets a project's rule when the project is deleted", async () => {
    const created = await api.post("/api/v1/projects", { name: "Short lived" });
    const id = (created.body as { project: { id: string } }).project.id;
    const put = await api.put("/api/v1/settings/approvals", {
      targetingReviewMode: [{ projects: [id], mode: "loose" }],
    });
    expect(put.status).toBe(200);

    const deleted = await api.delete(`/api/v1/projects/${id}`);
    expect(deleted.status).toBe(200);

    const settings = await api.get("/api/v1/settings");
    const rules = (
      settings.body as {
        settings: { targetingReviewMode: { projects: string[] }[] };
      }
    ).settings.targetingReviewMode;
    expect(rules.some((r) => r.projects.includes(id))).toBe(false);
  });
});
