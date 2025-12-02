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
  deleteSDKConnectionById,
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
  deleteSDKConnectionById: jest.fn(),
}));

jest.mock("shared/sdk-versioning", () => ({
  getLatestSDKVersion: jest.fn(),
  getSDKCapabilities: jest.fn(),
  getSDKVersions: jest.fn(),
}));

describe("sdk-connections API", () => {
  const { app, auditMock, setReqContext } = setupApp();
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

    createSDKConnection.mockImplementation((v) => {
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
    expect(auditMock).toHaveBeenCalledWith({
      details: `{"post":{"id":"${
        created.id
      }","name":"my-connection","organization":"org","dateCreated":"${created.dateCreated.toISOString()}","dateUpdated":"${created.dateUpdated.toISOString()}","languages":["javascript"],"environment":"production","projects":[],"encryptPayload":false,"encryptionKey":"","key":"${
        created.key
      }","connected":false,"proxy":{"enabled":false,"host":"","signingKey":"","connected":false,"version":"","error":"","lastError":null},"sdkVersion":"latest-version","includeVisualExperiments":false,"includeDraftExperiments":false,"includeExperimentNames":false,"includeRedirectExperiments":false,"includeRuleIds":false,"includeProjectPublicId":false,"includeCustomFields":[],"includeTags":[],"hashSecureAttributes":false},"context":{}}`,
      entity: { id: created.id, object: "sdk-connection" },
      event: "sdk-connection.create",
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
    expect(auditMock).toHaveBeenCalledWith({
      details: `{"pre":{"id":"${
        existing.id
      }","name":"my-connection","dateCreated":"${existing.dateCreated.toISOString()}","dateUpdated":"${existing.dateUpdated.toISOString()}","languages":["javascript"],"environment":"production","projects":[],"encryptPayload":false,"encryptionKey":"","key":"${
        existing.key
      }","connected":false,"proxy":{"enabled":false,"host":"","signingKey":"","connected":false,"version":"","error":"","lastError":null},"language":"javascript","sdkVersion":"latest-version"},"post":{"id":"${
        updated.id
      }","name":"my-new-connection","dateCreated":"${updated.dateCreated.toISOString()}","dateUpdated":"${updated.dateUpdated.toISOString()}","languages":["ruby"],"environment":"production","projects":[],"encryptionKey":"","key":"${
        updated.key
      }","connected":false,"proxy":{"enabled":false,"host":"","signingKey":"","connected":false,"version":"","error":"","lastError":null},"sdkVersion":"latest-version"},"context":{}}`,
      entity: { id: updated.id, object: "sdk-connection" },
      event: "sdk-connection.update",
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
    setReqContext({
      org,
      permissions: { canDeleteSDKConnection: () => true },
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

    expect(response.status).toBe(200);
    expect(deleteSDKConnectionById).toHaveBeenCalledWith("org", existing.id);
    expect(response.body).toEqual({ deletedId: existing.id });
    expect(auditMock).toHaveBeenCalledWith({
      details: `{"pre":{"id":"${
        existing.id
      }","name":"my-connection","dateCreated":"${existing.dateCreated.toISOString()}","dateUpdated":"${existing.dateCreated.toISOString()}","languages":["javascript"],"environment":"production","projects":[],"encryptPayload":false,"encryptionKey":"","key":"${
        existing.key
      }","connected":false,"proxy":{"enabled":false,"host":"","signingKey":"","connected":false,"version":"","error":"","lastError":null},"language":"javascript"},"context":{}}`,
      entity: { id: existing.id, object: "sdk-connection" },
      event: "sdk-connection.delete",
    });
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
    expect(deleteSDKConnectionById).not.toHaveBeenCalledWith();
    expect(response.body).toEqual({ message: "permission error" });
  });
});
