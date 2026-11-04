import express from "express";
import request from "supertest";
import { Collection } from "mongodb";
import { organizationsRouter } from "back-end/src/routers/organizations/organizations.router";
import * as organizationsController from "back-end/src/routers/organizations/organizations.controller";
import { getSignedPublicImageToken } from "back-end/src/routers/upload/upload.controller";
import { getExperimentByUid } from "back-end/src/models/ExperimentModel";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { Context } from "back-end/src/models/BaseModel";
import { NotFoundError } from "back-end/src/util/errors";

jest.mock("back-end/src/routers/organizations/organizations.controller");
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentByUid: jest.fn(async () => null),
}));

const app = express()
  .use(express.json())
  .use(organizationsRouter)
  .get("/upload/public-signed-url/:path*", getSignedPublicImageToken);

afterEach(() => {
  jest.clearAllMocks();
});

it.each([
  ["delete", "/keys", "deleteApiKey", { id: { a: 1 } }],
  ["delete", "/keys", "deleteApiKey", { key: { a: 1 } }],
  ["post", "/keys/reveal", "postApiKeyReveal", { id: { a: 1 } }],
  ["post", "/invite/accept", "postInviteAccept", { key: { a: 1 } }],
] as const)(
  "%s %s (%s) refuses %j before the handler runs",
  async (method, path, handler, body) => {
    const res = await request(app)[method](path).send(body);
    expect(res.status).toBe(400);
    expect(organizationsController[handler]).not.toHaveBeenCalled();
  },
);

// Bodies the three front-end callers send.
it.each([{ id: "key_1" }, { id: "", key: "dev_abc" }])(
  "delete /keys accepts %j",
  async (body) => {
    jest
      .mocked(organizationsController.deleteApiKey)
      .mockImplementation(async (req, res) => {
        res.json(req.body);
      });
    const res = await request(app).delete("/keys").send(body);
    expect(res.body).toEqual(body);
  },
);

describe("get /upload/public-signed-url", () => {
  const url = "/upload/public-signed-url/org_1/img.png?shareType=experiment";

  it("refuses a shareUid that is not a string before the lookup", async () => {
    const res = await request(app).get(`${url}&shareUid[a]=1`);
    expect(res.status).toBe(400);
    expect(getExperimentByUid).not.toHaveBeenCalled();
  });

  it("looks up a string shareUid", async () => {
    const res = await request(app).get(`${url}&shareUid=abc`);
    expect(res.body.message).toBe("Experiment not found");
  });
});

describe("ApiKeyModel.deleteByIdOrKey", () => {
  const deleteOne = jest.fn();
  class TestApiKeyModel extends ApiKeyModel {
    protected updateIndexes() {}
    protected _dangerousGetCollection() {
      const orgKey = { id: "key_1", key: "secret_abc", secret: true };
      return {
        findOne: async () => orgKey,
        deleteOne,
      } as unknown as Collection;
    }
  }

  it("answers not found for a key the caller may not delete", async () => {
    const model = new TestApiKeyModel({
      org: { id: "org_1" },
      populateForeignRefs: async () => {},
      permissions: {
        canViewApiKeys: () => true,
        canDeleteApiKey: () => false,
      },
      throwNotFoundError: () => {
        throw new NotFoundError();
      },
    } as unknown as Context);

    await expect(model.deleteByIdOrKey("key_1", undefined)).rejects.toThrow(
      NotFoundError,
    );
    expect(deleteOne).not.toHaveBeenCalled();
  });
});
