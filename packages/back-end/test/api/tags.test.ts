import mongoose from "mongoose";
import request from "supertest";
import { getAllTags } from "back-end/src/models/TagModel";
import { getAuthConnection } from "back-end/src/services/auth";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/services/auth", () => {
  const actual = jest.requireActual("back-end/src/services/auth");
  const middleware = jest.fn();
  return {
    ...actual,
    getAuthConnection: () => ({ middleware }),
    processJWT: jest.fn((req, _res, next) => {
      req.organization = {
        id: "org1",
        name: "Tags API",
        ownerEmail: "test@test.com",
        url: "",
        dateCreated: new Date(),
        members: [{ id: "user1", role: "admin" }],
        settings: {},
      };
      req.currentUser = {
        id: "user1",
        email: "test@test.com",
        name: "Test User",
        verified: true,
        superAdmin: true,
      };
      req.userId = "user1";
      req.email = "test@test.com";
      req.name = "Test User";
      req.superAdmin = true;
      req.teams = [];
      next();
    }),
  };
});

describe("tags API", () => {
  const { app, isReady } = setupApp();

  beforeEach(async () => {
    await isReady;
    getAuthConnection().middleware.mockImplementation((_req, _res, next) =>
      next(),
    );
  });

  async function postTag(body: Record<string, unknown>) {
    return request(app).post("/tag").send(body);
  }

  it("continues accepting the legacy tag payload without a label", async () => {
    const response = await postTag({
      id: "backend",
      color: "blue",
      description: "Backend work",
    });

    expect(response.status).toBe(200);
    expect(await getAllTags("org1")).toEqual([
      {
        id: "backend",
        label: "backend",
        color: "blue",
        description: "Backend work",
      },
    ]);
  });

  it("accepts an editable label", async () => {
    const response = await postTag({
      id: "backend",
      label: "Backend Engineering",
      color: "blue",
      description: "Backend work",
    });

    expect(response.status).toBe(200);
    expect(await getAllTags("org1")).toEqual([
      {
        id: "backend",
        label: "Backend Engineering",
        color: "blue",
        description: "Backend work",
      },
    ]);
  });

  it("rejects invalid and unknown label properties", async () => {
    const invalidLabel = await postTag({
      id: "backend",
      label: 123,
      color: "blue",
      description: "",
    });
    const unknownProperty = await postTag({
      id: "backend",
      label: "Backend",
      color: "blue",
      description: "",
      unexpected: true,
    });

    expect(invalidLabel.status).toBe(400);
    expect(unknownProperty.status).toBe(400);
    expect(await getAllTags("org1")).toEqual([]);
  });

  it("preserves a renamed label when a legacy caller updates the tag", async () => {
    await postTag({
      id: "backend",
      label: "Backend Engineering",
      color: "blue",
      description: "Backend work",
    });

    const response = await postTag({
      id: "backend",
      color: "teal",
      description: "Backend services",
    });

    expect(response.status).toBe(200);
    expect(await getAllTags("org1")).toEqual([
      {
        id: "backend",
        label: "Backend Engineering",
        color: "teal",
        description: "Backend services",
      },
    ]);
  });

  it("rejects duplicate labels but allows updating the same tag", async () => {
    await postTag({
      id: "backend",
      label: "Backend Engineering",
      color: "blue",
      description: "",
    });

    const sameTag = await postTag({
      id: "backend",
      label: "Backend Engineering",
      color: "teal",
      description: "Updated",
    });
    const duplicate = await postTag({
      id: "platform",
      label: "Backend Engineering",
      color: "gold",
      description: "",
    });

    expect(sameTag.status).toBe(200);
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({
      status: 400,
      message: "A tag with this name already exists.",
    });
    expect(await getAllTags("org1")).toHaveLength(1);
  });

  it("does not overwrite a renamed tag when creating with its hidden id", async () => {
    await postTag({
      id: "backend",
      label: "Backend Engineering",
      color: "blue",
      description: "Original tag",
      createOnly: true,
    });

    const response = await postTag({
      id: "backend",
      label: "backend",
      color: "gold",
      description: "Should not overwrite",
      createOnly: true,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 400,
      message: "A tag with this name already exists or was previously renamed.",
    });
    expect(await getAllTags("org1")).toEqual([
      {
        id: "backend",
        label: "Backend Engineering",
        color: "blue",
        description: "Original tag",
      },
    ]);
  });

  it("stores tag ids containing dots as literal settings keys", async () => {
    const response = await postTag({
      id: "backend.api",
      label: "Backend API",
      color: "blue",
      description: "",
    });
    const document = await mongoose.connection
      .collection("tags")
      .findOne({ organization: "org1" });

    expect(response.status).toBe(200);
    expect(document?.settings["backend.api"]).toEqual({
      color: "blue",
      description: "",
      label: "Backend API",
    });
    expect(document?.settings.backend).toBeUndefined();
  });

  it("enforces the tag name length for labels", async () => {
    const tooShort = await postTag({
      id: "backend",
      label: "x",
      color: "blue",
      description: "",
    });
    const tooLong = await postTag({
      id: "platform",
      label: "x".repeat(65),
      color: "blue",
      description: "",
    });

    expect(tooShort.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(await getAllTags("org1")).toEqual([]);
  });
});
