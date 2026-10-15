import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeatureMetaInfoById } from "back-end/src/models/FeatureModel";
import { setupApp } from "./api.setup";

const ORG_ID = "org_feature_meta_info";
const org = {
  id: ORG_ID,
  name: "Meta info",
  ownerEmail: "t@t.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: ["production", "dev"].map((id) => ({ id, description: "" })),
  },
} as unknown as OrganizationInterface;

const adminContext = () =>
  new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_admin" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });

const date = new Date("2026-01-01T00:00:00Z");
const prerequisite = { id: "parent", condition: '{"value": true}' };

function insertFeature(doc: Record<string, unknown>) {
  return mongoose.connection.collection("features").insertOne({
    organization: ORG_ID,
    owner: "o",
    description: "",
    valueType: "boolean",
    defaultValue: "true",
    project: "",
    archived: false,
    version: 1,
    dateCreated: date,
    dateUpdated: date,
    ...doc,
  });
}

setupApp();

it("summarizes each flag the same whatever its stored shape", async () => {
  await insertFeature({
    id: "bare",
    environmentSettings: { production: { enabled: true } },
  });
  await insertFeature({
    id: "full",
    tags: ["t"],
    targetingProjects: ["prj_a"],
    linkedExperiments: ["exp_1"],
    neverStale: true,
    baseConfig: "cfg_1",
    rules: [
      { id: "r1", type: "force", value: "true", savedGroups: [{ ids: ["g"] }] },
    ],
    environmentSettings: { production: { enabled: true } },
  });
  await insertFeature({
    id: "rule_prereq",
    rules: [
      { id: "r1", type: "force", value: "true", prerequisites: [prerequisite] },
    ],
    environmentSettings: { production: { enabled: true } },
  });
  await insertFeature({
    id: "env_prereq",
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true, prerequisites: [prerequisite] },
    },
  });
  await insertFeature({
    id: "legacy_rules",
    environmentSettings: {
      production: {
        enabled: true,
        rules: [{ id: "r1", type: "force", value: "x".repeat(1000) }],
      },
    },
  });

  const byId = Object.fromEntries(
    (await getFeatureMetaInfoById(adminContext())).map((f) => [f.id, f]),
  );

  expect(byId.bare).toEqual({
    id: "bare",
    project: "",
    targetingProjects: [],
    targetingAllProjects: undefined,
    archived: false,
    description: "",
    dateCreated: date,
    dateUpdated: date,
    tags: [],
    owner: "o",
    valueType: "boolean",
    version: 1,
    linkedExperiments: [],
    neverStale: undefined,
    hasPrerequisites: false,
    hasSavedGroups: false,
    configBackingKey: null,
    revision: undefined,
  });
  expect(byId.full).toMatchObject({
    tags: ["t"],
    targetingProjects: ["prj_a"],
    linkedExperiments: ["exp_1"],
    neverStale: true,
    hasSavedGroups: true,
    hasPrerequisites: false,
    configBackingKey: "cfg_1",
  });
  expect(byId.rule_prereq.hasPrerequisites).toBe(true);
  expect(byId.env_prereq.hasPrerequisites).toBe(true);
  expect(byId.legacy_rules).toMatchObject({
    hasPrerequisites: false,
    hasSavedGroups: false,
  });
  expect(byId.bare).not.toHaveProperty("defaultValue");

  const [withDefault] = await getFeatureMetaInfoById(adminContext(), {
    ids: ["bare"],
    includeDefaultValue: true,
  });
  expect(withDefault.defaultValue).toBe("true");
});
