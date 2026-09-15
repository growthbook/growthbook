import type { Request } from "express";
import mongoose from "mongoose";
import request from "supertest";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// With registered attributes enforced per project, a rule that targets a
// subset of the feature's projects is validated against that subset, not the
// whole delivery set. Rule project scope is written through the whole-feature
// v2 endpoint; the revision rule endpoints carry no scope fields.
const ORG_ID = "org_rule_attribute_scope";
const A = "prj_a";
const B = "prj_b";

const org = {
  id: ORG_ID,
  name: "Rule Attribute Scope",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production" }],
    requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
    attributeSchema: [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "only_a", datatype: "string", projects: [A] },
      { property: "only_b", datatype: "string", projects: [B] },
    ],
  },
} as unknown as OrganizationInterface;

const now = () => new Date();

describe("rule-level attribute scope", () => {
  const { app, setReqContext } = setupApp();
  const FLAG = "flag_rule_scope";
  const UPDATE = `/api/v2/features/${FLAG}`;

  beforeEach(async () => {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_engineer" },
      role: "engineer",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);
    for (const id of [A, B]) {
      await mongoose.connection.collection("projects").insertOne({
        id,
        organization: ORG_ID,
        name: id,
        dateCreated: now(),
        dateUpdated: now(),
      });
    }
    await mongoose.connection.collection("features").insertOne({
      id: FLAG,
      organization: ORG_ID,
      owner: "",
      description: "",
      valueType: "boolean",
      defaultValue: "false",
      version: 2,
      archived: false,
      tags: [],
      rules: [],
      project: B,
      targetingProjects: [A],
      environmentSettings: { production: { enabled: true, rules: [] } },
      prerequisites: [],
      dateCreated: now(),
      dateUpdated: now(),
    });
    for (const [version, status] of [
      [1, "published"],
      [2, "draft"],
    ] as const) {
      await mongoose.connection.collection("featurerevisions").insertOne({
        id: `frev_${FLAG}_${version}`,
        organization: ORG_ID,
        featureId: FLAG,
        version,
        baseVersion: version - 1,
        status,
        createdBy: { type: "api_key", apiKey: "key_engineer" },
        comment: "",
        defaultValue: "false",
        rules: [],
        dateCreated: now(),
        dateUpdated: now(),
        ...(status === "published" ? { datePublished: now() } : {}),
      });
    }
  });

  const add = (rule: Record<string, unknown>) =>
    request(app)
      .post(UPDATE)
      .send({
        rules: [
          {
            type: "force",
            value: "true",
            allEnvironments: true,
            condition: '{"only_a": "x"}',
            ...rule,
          },
        ],
      })
      .set("Authorization", "Bearer foo");

  it("accepts an attribute from any delivered-to project for an unscoped rule", async () => {
    expect((await add({})).status).toBe(200);
  });

  it("accepts it when the rule targets the project that owns the attribute", async () => {
    expect((await add({ allProjects: false, projects: [A] })).status).toBe(200);
  });

  it("rejects it when the rule targets only a project the attribute is not on", async () => {
    const res = await add({ allProjects: false, projects: [B] });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/only_a/);
  });

  it("leaves an existing rule's unchanged out-of-scope attribute alone", async () => {
    const stale = {
      id: "fr_stale",
      type: "force",
      value: "true",
      enabled: true,
      description: "",
      allEnvironments: true,
      allProjects: false,
      projects: [B],
      condition: '{"only_a": "x"}',
    };
    await mongoose.connection
      .collection("features")
      .updateOne(
        { organization: ORG_ID, id: FLAG },
        { $set: { rules: [stale] } },
      );
    const renamed = await add({ ...stale, description: "renamed" });
    expect(renamed.status).toBe(200);
    const retargeted = await add({ ...stale, condition: '{"only_a": "y"}' });
    expect(retargeted.status).toBe(400);
  });
});
