import request from "supertest";
import {
  getLatestSDKVersion,
  getSDKCapabilities,
  getSDKVersions,
} from "shared/sdk-versioning";
import {
  toApiSDKConnectionInterface,
  findSDKConnectionsByOrganization,
  createSDKConnection,
  findSDKConnectionById,
  editSDKConnection,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import {
  validatePutPayload,
  validatePostPayload,
} from "back-end/src/api/sdk-connections/validations";
import { sdkConnectionFactory } from "back-end/test/factories/SdkConnection.factory";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/api/sdk-connections/validations", () => ({
  validatePutPayload: jest.fn(),
  validatePostPayload: jest.fn(),
}));

const originalValidatePutPayload = jest.requireActual(
  "back-end/src/api/sdk-connections/validations",
).validatePutPayload;

const originalValidatePostPayload = jest.requireActual(
  "back-end/src/api/sdk-connections/validations",
).validatePostPayload;

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  toApiSDKConnectionInterface: jest.fn(),
  createSDKConnection: jest.fn(),
  editSDKConnection: jest.fn(),
  findSDKConnectionById: jest.fn(),
  findSDKConnectionsByOrganization: jest.fn(),
  deleteSDKConnectionModel: jest.fn(),
}));

jest.mock("shared/sdk-versioning", () => ({
  getLatestSDKVersion: jest.fn(),
  getSDKCapabilities: jest.fn(),
  getSDKVersions: jest.fn(),
}));

describe("sdk-connections API", () => {
  const { app, setReqContext } = setupApp();
  const mockApiSDKConnectionInterface = ({ id }) => `mock-${id}`;

  beforeEach(() => {
    validatePutPayload.mockImplementation(originalValidatePutPayload);
    validatePostPayload.mockImplementation(originalValidatePostPayload);
    getSDKVersions.mockReturnValue(["old-version", "latest-version"]);
    toApiSDKConnectionInterface.mockImplementation(
      mockApiSDKConnectionInterface,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org", environments: [{ id: "production" }] };

  it("can list all sdk-connections", async () => {
    setReqContext({ org });

    const connections = [...Array(10)].map(() =>
      sdkConnectionFactory.build({
        organization: org.id,
        environments: org.environments[0],
      }),
    );

    findSDKConnectionsByOrganization.mockReturnValue(connections);

    const response = await request(app)
      .get("/api/v1/sdk-connections")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      connections: connections.map(mockApiSDKConnectionInterface),
      count: 10,
      hasMore: false,
      limit: 10,
      nextOffset: null,
      offset: 0,
      total: 10,
    });
  });

  it("can paginate sdk-connections", async () => {
    setReqContext({ org });

    const connections = [...Array(10)].map(() =>
      sdkConnectionFactory.build({
        organization: org.id,
        environment: org.environments[0].id,
      }),
    );

    findSDKConnectionsByOrganization.mockReturnValue(connections);

    const response = await request(app)
      .get("/api/v1/sdk-connections?limit=5&offset=5")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      connections: connections.slice(5, 11).map(mockApiSDKConnectionInterface),
      count: 5,
      hasMore: false,
      limit: 5,
      nextOffset: null,
      offset: 5,
      total: 10,
    });
  });

  it("can create new sdk-connections", async () => {
    setReqContext({ org, permissions: { canCreateSDKConnection: () => true } });

    let created;

    createSDKConnection.mockImplementation((c, v) => {
      created = sdkConnectionFactory.build(v);
      return created;
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      sdkVersion: "latest-version",
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sdkConnection: mockApiSDKConnectionInterface(created),
    });
  });

  it("checks permission when creating new sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      sdkVersion: "latest-version",
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "permission error" });
  });

  it("validates payload when creating new sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [language] Invalid input: expected string, received undefined",
    });
  });

  it("checks for premium features when creating new sdk-connections", async () => {
    const hasPremiumFeatureMock = jest.fn(() => false);
    getLatestSDKVersion.mockReturnValue("latest-version");
    getSDKCapabilities.mockReturnValue(["encryption"]);

    setReqContext({
      org,
      hasPremiumFeature: hasPremiumFeatureMock,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      encryptPayload: true,
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(getSDKCapabilities).toHaveBeenCalledWith(
      "javascript",
      "latest-version",
    );
    expect(hasPremiumFeatureMock).toHaveBeenCalledWith(
      "encrypt-features-endpoint",
    );
    expect(response.body).toEqual({
      message:
        "Feature encrypt-features-endpoint requires premium subscription!",
    });
  });

  it("checks for premium features overrides when creating new sdk-connections", async () => {
    const hasPremiumFeatureMock = jest.fn(() => false);
    getLatestSDKVersion.mockReturnValue("latest-version");
    getSDKCapabilities.mockReturnValue(["encryption"]);

    setReqContext({
      org,
      hasPremiumFeature: hasPremiumFeatureMock,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      proxyEnabled: true,
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
  });

  it("checks for SDK cacapbilities when creating new sdk-connections", async () => {
    getLatestSDKVersion.mockReturnValue("latest-version");
    getSDKCapabilities.mockReturnValue([]);

    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      remoteEvalEnabled: true,
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(getSDKCapabilities).toHaveBeenCalledWith(
      "javascript",
      "latest-version",
    );
    expect(response.body).toEqual({
      message: "SDK version latest-version does not support remoteEval",
    });
  });

  it("checks for SDK cacapbilities for the latest version when creating new sdk-connections", async () => {
    getLatestSDKVersion.mockReturnValue("latest-version");
    getSDKCapabilities.mockImplementation((_, v) =>
      v === "latest-version" ? ["remoteEval"] : [],
    );

    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      sdkVersion: "old-version",
      environment: org.environments[0].id,
      language: "javascript",
      remoteEvalEnabled: true,
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "You need to ugrade to version latest-version to support remoteEval",
    });
  });

  it("checks for invalid languages when creating new sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my-connection",
      environment: org.environments[0].id,
      language: "teapot",
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Language teapot is not supported!",
    });
  });

  it("checks for invalid name when creating new sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canCreateSDKConnection: () => true,
      },
    });

    const connection = {
      name: "my",
      environment: org.environments[0].id,
      language: "javascript",
    };

    const response = await request(app)
      .post("/api/v1/sdk-connections")
      .send(connection)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Name length must be at least 3 characters",
    });
  });

  it("can update sdk-connections", async () => {
    const context = {
      org,
      permissions: { canUpdateSDKConnection: () => true },
    };
    setReqContext(context);

    const existing = sdkConnectionFactory.build({
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
      sdkVersion: "latest-version",
    });

    findSDKConnectionById.mockReturnValue(existing);

    let updated;

    editSDKConnection.mockImplementation((_, __, v) => {
      updated = { ...sdkConnectionFactory.build(v), id: existing.id };
      return updated;
    });

    const update = {
      name: "my-new-connection",
      environment: org.environments[0].id,
      language: "ruby",
    };

    const response = await request(app)
      .put(`/api/v1/sdk-connections/${existing.id}`)
      .send(update)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    // This validates all exception handling tested in create mode.
    expect(validatePutPayload).toHaveBeenCalledWith(context, update, existing);
    expect(findSDKConnectionById).toHaveBeenCalledWith(context, existing.id);
    expect(editSDKConnection).toHaveBeenCalledWith(
      context,
      existing,
      await originalValidatePutPayload(context, update, existing),
    );
    expect(response.body).toEqual({
      sdkConnection: mockApiSDKConnectionInterface(updated),
    });
  });

  it("checks for permission when updating sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canUpdateSDKConnection: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const existing = sdkConnectionFactory.build({
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
    });

    findSDKConnectionById.mockReturnValue(existing);

    const update = {
      name: "my-new-connection",
      environment: org.environments[0].id,
      language: "ruby",
    };

    const response = await request(app)
      .put(`/api/v1/sdk-connections/${existing.id}`)
      .send(update)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(editSDKConnection).not.toHaveBeenCalled();
    expect(response.body).toEqual({ message: "permission error" });
  });

  it("can delete sdk-connections", async () => {
    const context = {
      org,
      permissions: { canDeleteSDKConnection: () => true },
    };
    setReqContext(context);

    const existing = sdkConnectionFactory.build({
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
    });

    findSDKConnectionById.mockReturnValue(existing);

    const response = await request(app)
      .delete(`/api/v1/sdk-connections/${existing.id}`)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(deleteSDKConnectionModel).toHaveBeenCalledWith(context, existing);
    expect(response.body).toEqual({ deletedId: existing.id });
  });

  it("checks for permissions when deleting sdk-connections", async () => {
    setReqContext({
      org,
      permissions: {
        canDeleteSDKConnection: () => false,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
    });

    const existing = sdkConnectionFactory.build({
      name: "my-connection",
      environment: org.environments[0].id,
      language: "javascript",
    });

    findSDKConnectionById.mockReturnValue(existing);

    const response = await request(app)
      .delete(`/api/v1/sdk-connections/${existing.id}`)
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(deleteSDKConnectionModel).not.toHaveBeenCalledWith();
    expect(response.body).toEqual({ message: "permission error" });
  });
});
