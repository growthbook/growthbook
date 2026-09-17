import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Feature create, update and toggle accept an optional `comment` for the
// revision they publish. Omitting it keeps the previous values: "" on the
// initial revision, "Created via REST API" on update and toggle.

const ORG_ID = "org_revision_comment";
const FLAG = "example_widget_enabled";
const org = {
  id: ORG_ID,
  name: "Revision Comment",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production" }],
    restApiBypassesReviews: true,
  },
} as unknown as OrganizationInterface;

async function insertFeature() {
  const now = new Date();
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    project: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${FLAG}_1`,
    organization: ORG_ID,
    featureId: FLAG,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "false",
    rules: [],
    dateCreated: now,
    dateUpdated: now,
    datePublished: now,
  });
}

const revisionComment = async (featureId: string, version: number) =>
  (
    await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId, version })
  )?.comment;

describe("revision comment on feature create, update and toggle", () => {
  const { app, auditMock, setReqContext } = setupApp();

  const send = (path: string, body: unknown) =>
    request(app).post(path).send(body).set("Authorization", "Bearer foo");

  beforeEach(() => {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_admin" },
        role: "admin",
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
  });

  describe.each([
    ["v1", "/api/v1/features"],
    ["v2", "/api/v2/features"],
  ])("%s", (_version, base) => {
    it("create records the comment on the initial revision", async () => {
      const res = await send(base, {
        id: FLAG,
        valueType: "boolean",
        defaultValue: "false",
        owner: "flag-owner",
        comment: "created by the deploy pipeline",
      });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 1)).toBe(
        "created by the deploy pipeline",
      );
    });

    it("create without a comment keeps the empty initial comment", async () => {
      const res = await send(base, {
        id: FLAG,
        valueType: "boolean",
        defaultValue: "false",
        owner: "flag-owner",
      });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 1)).toBe("");
    });

    it("update records the comment on the revision it publishes", async () => {
      await insertFeature();
      const res = await send(`${base}/${FLAG}`, {
        defaultValue: "true",
        comment: "flip default for launch",
      });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 2)).toBe("flip default for launch");
    });

    it("update without a comment keeps the default comment", async () => {
      await insertFeature();
      const res = await send(`${base}/${FLAG}`, { defaultValue: "true" });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 2)).toBe("Created via REST API");
    });

    it("toggle records the comment on the published revision and still audits the reason", async () => {
      await insertFeature();
      const res = await send(`${base}/${FLAG}/toggle`, {
        environments: { production: false },
        reason: "pause",
        comment: "pausing during maintenance",
      });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 2)).toBe("pausing during maintenance");
      expect(auditMock).toHaveBeenCalledWith(
        expect.objectContaining({ event: "feature.toggle", reason: "pause" }),
      );
    });

    it("toggle without a comment keeps the default comment", async () => {
      await insertFeature();
      const res = await send(`${base}/${FLAG}/toggle`, {
        environments: { production: false },
      });
      expect(res.status).toBe(200);
      expect(await revisionComment(FLAG, 2)).toBe("Created via REST API");
    });
  });
});
