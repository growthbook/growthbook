import { vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { setupApp } from "../api.setup";

vi.mock("back-end/src/models/SdkConnectionModel", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/models/SdkConnectionModel")
  >("back-end/src/models/SdkConnectionModel")),
  findSDKConnectionsByOrganization: vi.fn(),
}));

// Moving a flag out of a project that still serves a flag gating on it is a
// 422 the caller can acknowledge with ignoreWarnings.

const ORG_ID = "org_move_guard";
const org = {
  id: ORG_ID,
  name: "Move Guard",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

async function insertFeature(
  id: string,
  project: string,
  prerequisites: { id: string; condition: string }[] = [],
) {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    project,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${id}_1`,
    organization: ORG_ID,
    featureId: id,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "false",
    rules: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: new Date(),
  });
}

describe("moving a prerequisite parent", () => {
  const { app, setReqContext } = setupApp();

  // The harness pins one context per test, so the acknowledgement is set on
  // the context rather than read from the request body.
  const useContext = (body: Record<string, unknown> = {}) =>
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_admin" },
        role: "admin",
        req: { query: {}, headers: {}, body } as unknown as Request,
      }),
    );

  beforeEach(async () => {
    useContext();
    await mongoose.connection
      .collection("projects")
      .insertMany(
        ["A", "B"].map((id) => ({ id, organization: ORG_ID, name: id })),
      );
    await insertFeature("parent", "B");
    await insertFeature("dep", "B", [{ id: "parent", condition: "{}" }]);
    vi.mocked(findSDKConnectionsByOrganization).mockResolvedValue([
      {
        projects: ["B"],
        environment: "production",
        languages: ["javascript"],
        sdkVersion: "1.5.0",
        includeReferencedPrerequisites: false,
      },
    ] as never);
  });

  it("warns on the v2 update and proceeds once acknowledged", async () => {
    const send = (body: unknown) =>
      request(app)
        .post("/api/v2/features/parent")
        .send(body)
        .set("Authorization", "Bearer foo");

    const warned = await send({ project: "A" });
    expect(warned.status).toBe(422);
    expect(warned.body.warnings).toEqual(["1 feature flag(s)"]);

    useContext({ ignoreWarnings: true });
    const moved = await send({ project: "A", ignoreWarnings: true });
    expect(moved.body.message).toBeUndefined();
    expect(moved.status).toBe(200);
    expect(moved.body.feature.project).toBe("A");
  });
});
