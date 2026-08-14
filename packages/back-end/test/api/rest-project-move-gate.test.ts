import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { CUSTOM_ROLES, ENVS } from "./permission-personas.fixture";
import { setupApp } from "./api.setup";

/**
 * Moving an entity to another Project takes authority on BOTH sides — you must
 * be allowed to take it out of where it is AND to land it where it's going.
 *
 * The model backstop (`canLandEntityUpdate`) does check the destination, but it
 * accepts REVERT authority there: it has no revision to judge purity against,
 * so from its position a move is indistinguishable from a restore. Revert
 * authority is meant to restore a previously-published state, not to admit
 * arbitrary new content — so a caller holding publish in the source and revert
 * in the destination could move an entity and rewrite its value in one request,
 * landing content in a project where they hold no publish rights.
 *
 * The internal controllers close this with an explicit destination publish
 * check. The REST update handlers did not, which is what this pins: the two
 * surfaces have to answer identically. Direct handler coverage, because the
 * persona matrix grants uniform authority org-wide and cannot express
 * "publish here, revert there".
 */

const SRC = "prj_src";
const DST = "prj_dst";

const org = {
  id: "org_rest_project_move",
  name: "REST Project Move",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  customRoles: [
    ...CUSTOM_ROLES,
    // Draft + revert everywhere, publish nowhere. Paired with an `editor`
    // project role this isolates the destination publish check: the caller
    // clears the two-sided draft gate and the model backstop's revert fallback,
    // so a refusal can only come from the destination's publish requirement.
    {
      id: "draft_reverter",
      description: "Draft and revert, no publish",
      policies: [
        "ReadData",
        "FlagsEditDrafts",
        "FlagsRevert",
        "SavedGroupsEditDrafts",
        "SavedGroupsRevert",
      ],
    },
  ] as unknown as OrganizationInterface["customRoles"],
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    // Publish in the source, revert in the destination: enough to satisfy the
    // model backstop, not enough to land new content in the destination.
    {
      id: "u_split",
      role: "draft_reverter",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [
        {
          project: SRC,
          role: "editor",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ],
    },
    // Publish on both sides — the move is legitimately theirs to make.
    {
      id: "u_both",
      role: "draft_reverter",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [
        {
          project: SRC,
          role: "editor",
          limitAccessByEnvironment: false,
          environments: [],
        },
        {
          project: DST,
          role: "editor",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ],
    },
  ],
  settings: {
    environments: ENVS.map((id) => ({ id, description: "" })),
    attributeSchema: [{ property: "userId", datatype: "string" }],
  },
} as unknown as OrganizationInterface;

describe("moving an entity across Projects over REST", () => {
  const { app, setReqContext } = setupApp();

  function as(userId: string, role: string) {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: `k_${userId}` },
        user: {
          id: userId,
          email: `${userId}@test.com`,
          name: userId,
          superAdmin: false,
        },
        role,
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
  }

  // The update route is POST /constants/:key, not PUT.
  const update = (key: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/constants/${key}`)
      .send(body)
      .set("Authorization", "Bearer x");

  let seq = 0;
  async function seedConstant(): Promise<string> {
    const key = `moved_const_${++seq}`;
    // The harness clears every collection after each test, so the projects the
    // move targets have to be re-seeded alongside the entity.
    await mongoose.connection.collection("projects").insertMany(
      [SRC, DST].map((id) => ({
        id,
        organization: org.id,
        name: id,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      })),
    );
    as("u_admin", "admin");
    const res = await request(app)
      .post("/api/v1/constants")
      .send({
        key,
        name: "Move Constant",
        type: "json",
        value: '{"timeout":30}',
        project: SRC,
      })
      .set("Authorization", "Bearer x");
    if (res.status >= 400) {
      throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return key;
  }

  it("refuses a move that rewrites the value without publish in the destination", async () => {
    const key = await seedConstant();

    as("u_split", "draft_reverter");
    const res = await update(key, {
      project: DST,
      value: '{"timeout":99}',
    });

    expect(res.status).toBe(403);
  });

  it("allows the same move for a caller who can publish on both sides", async () => {
    const key = await seedConstant();

    as("u_both", "draft_reverter");
    const res = await update(key, {
      project: DST,
      value: '{"timeout":99}',
    });

    expect(res.status).toBe(200);
  });

  it("still allows an in-place edit in the source, where publish is held", async () => {
    const key = await seedConstant();

    as("u_split", "draft_reverter");
    const res = await update(key, { value: '{"timeout":45}' });

    expect(res.status).toBe(200);
  });
});
