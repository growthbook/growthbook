import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { getSDKCapabilities, getLatestSDKVersion } from "shared/sdk-versioning";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getFeatureDefinitions } from "back-end/src/services/features";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

// A project-scoped getFeatureDefinitions loads only its own projects' features,
// then loads the prerequisite parents they gate on from other projects, round
// by round. That loader and the payload's closure must agree per environment:
// a parent loaded too narrowly is missing from the payload, so its gate never
// passes.

jest.setTimeout(60000);

const ORG_ID = "org_prerequisite_closure_environment";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const ENVIRONMENTS = ["production", "development"];

const org = {
  id: ORG_ID,
  name: "Prerequisite closure environment",
  ownerEmail: "owner@example.com",
  url: "",
  dateCreated: NOW,
  members: [],
  invites: [],
  settings: {
    environments: ENVIRONMENTS.map((id) => ({ id, description: "" })),
  },
} as unknown as OrganizationInterface;

const gatedOn = (parent: string, environments: string[] | null) => ({
  ...(environments
    ? { allEnvironments: false, environments }
    : { allEnvironments: true }),
  prerequisites: [{ id: parent, condition: '{"value": true}' }],
});

// A rule keeps each parent conditional, so its gate isn't folded away.
const conditional = { value: "false", condition: '{"country":"FR"}' };

function feature(
  id: string,
  project: string,
  rules: Record<string, unknown>[],
) {
  return {
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    project,
    valueType: "boolean",
    defaultValue: "true",
    version: 1,
    archived: false,
    tags: [],
    prerequisites: [],
    environmentSettings: Object.fromEntries(
      ENVIRONMENTS.map((env) => [env, { enabled: true }]),
    ),
    rules: rules.map((rule, i) => ({
      id: `${id}_rule_${i}`,
      description: "",
      enabled: true,
      allEnvironments: true,
      type: "force",
      value: "true",
      ...rule,
    })),
    dateCreated: NOW,
    dateUpdated: NOW,
  };
}

let context: ReturnType<typeof getContextForAgendaJobByOrgObject>;

beforeAll(async () => {
  await connectTestMongo();
  await mongoose.connection
    .db!.collection("features")
    .insertMany([
      feature("child", "prj_child", [gatedOn("parent", null)]),
      feature("parent", "prj_parent", [
        conditional,
        gatedOn("prod_grandparent", ["production"]),
        gatedOn("dev_grandparent", ["development"]),
      ]),
      feature("prod_grandparent", "prj_prod", [conditional]),
      feature("dev_grandparent", "prj_dev", [conditional]),
    ]);
  context = getContextForAgendaJobByOrgObject(org);
});

afterAll(async () => {
  await waitForIndexes();
  await disconnectTestMongo();
});

const definitionsFor = async (environment: string) =>
  Object.keys(
    (
      await getFeatureDefinitions({
        context,
        capabilities: getSDKCapabilities(
          "javascript",
          getLatestSDKVersion("javascript"),
        ),
        environment,
        projects: ["prj_child"],
        includeReferencedPrerequisites: true,
      })
    ).features,
  ).sort();

it.each([
  ["production", ["child", "parent", "prod_grandparent"]],
  ["development", ["child", "dev_grandparent", "parent"]],
])(
  "a %s payload carries the parents that environment gates on, across load rounds",
  async (environment, expected) => {
    expect(await definitionsFor(environment)).toEqual(expected);
  },
);
