import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// Publishing must compare the revision's snapshot against the live document
// the same way the snapshot was normalized at capture. A stored document can
// carry representation-only differences — an explicit null on an optional
// field, a field removed from the schema — that never show up in API output;
// comparing them raw makes every draft of the entity fail the
// requireRebaseBeforePublish gate forever (rebasing re-normalizes and cannot
// clear it).

const ORG_ID = "org_sg_publish_gate";
const GROUP_ID = "grp_publish_gate_test";

const org = {
  id: ORG_ID,
  name: "SG Publish Gate",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    requireRebaseBeforePublish: true,
  },
} as unknown as OrganizationInterface;

describe("POST /api/v1/saved-groups/:id/revisions/:version/publish", () => {
  const { app, setReqContext } = setupApp();

  it("publishes a fresh draft of a document that carries legacy nullish fields", async () => {
    // The caller can edit saved groups but cannot bypass approval checks —
    // the shape the rebase gate applies to.
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "engineer",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    setReqContext(context);

    // Raw stored document with an explicit null on an optional updatable
    // field — invisible in every API response, present only on the raw doc.
    await mongoose.connection.collection("savedgroups").insertOne({
      id: GROUP_ID,
      organization: ORG_ID,
      groupName: "Gate test group",
      owner: "",
      type: "condition",
      condition: '{"id": {"$in": ["a"]}}',
      description: null,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    // Create the draft through the API so its snapshot is captured by the
    // real adapter (which normalizes nullish fields away).
    const createRes = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(createRes.status).toBe(200);
    const version = createRes.body.revision.version;

    const editRes = await request(app)
      .put(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/condition`)
      .send({ condition: '{"id": {"$in": ["a", "b"]}}' })
      .set("Authorization", "Bearer foo");
    expect(editRes.status).toBe(200);

    // Nothing changed the live document since the draft was created, so the
    // rebase gate must not fire.
    const publishRes = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    const doc = await mongoose.connection
      .collection("savedgroups")
      .findOne({ id: GROUP_ID });
    expect(doc?.condition).toBe('{"id": {"$in": ["a", "b"]}}');
  });
});
