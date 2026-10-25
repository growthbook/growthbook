import mongoose from "mongoose";
import type { Job } from "agenda";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import { ReqContextClass } from "back-end/src/services/context";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";

export const ORG_ID = "org_sched";
export const EXP_ID = "exp_sched";
export const HOUR = 60 * 60 * 1000;

const users = {
  u_owner: "admin",
  u_exp: "experimenter",
  u_collab: "collaborator",
};
export const org = {
  id: ORG_ID,
  name: "Scheduling",
  ownerEmail: "owner@test.com",
  url: "",
  dateCreated: new Date(),
  members: Object.entries(users).map(([id, role]) => ({
    id,
    role,
    environments: [],
    limitAccessByEnvironment: false,
    projectRoles: [],
  })),
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

export const experiments = () => mongoose.connection.collection("experiments");
export const organizations = () =>
  mongoose.connection.collection("organizations");
export const revisions = () =>
  mongoose.connection.collection("featurerevisions");

export async function seedOrg(orgDoc: OrganizationInterface = org) {
  await organizations().insertOne({ ...orgDoc });
  await mongoose.connection.collection("users").insertMany(
    Object.keys(users).map((id) => ({
      id,
      email: `${id}@test.com`,
      name: id,
    })),
  );
}

export function asUser(id: string, orgDoc: OrganizationInterface = org) {
  const context = new ReqContextClass({
    org: orgDoc,
    auditUser: { type: "dashboard", id, email: `${id}@test.com`, name: id },
    user: { id, email: `${id}@test.com`, name: id },
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

export const keyDoc = (
  id: string,
  role: string,
  extra: Partial<ApiKeyInterface> = {},
) =>
  ({
    id,
    organization: ORG_ID,
    key: `secret_${id}`,
    secret: true,
    description: id,
    role,
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...extra,
  }) as unknown as ApiKeyInterface;

export function asKey(
  key: ApiKeyInterface,
  orgDoc: OrganizationInterface = org,
) {
  const context = new ReqContextClass({
    org: orgDoc,
    auditUser: { type: "api_key", apiKey: key.id, name: key.description },
    role: key.role,
    apiKey: key.id,
    apiKeyData: key,
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

export async function insertExperiment(fields: Record<string, unknown>) {
  await experiments().insertOne({
    id: EXP_ID,
    organization: ORG_ID,
    trackingKey: EXP_ID,
    name: "Checkout test",
    type: "standard",
    owner: "u_owner",
    project: "",
    hypothesis: "",
    description: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    archived: false,
    status: "draft",
    autoSnapshots: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "0", key: "0", name: "Control", screenshots: [] },
      { id: "1", key: "1", name: "Variation", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: new Date(Date.now() - HOUR),
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        savedGroups: [],
        namespace: { enabled: false, name: "", range: [0, 1] },
        variationWeights: [0.5, 0.5],
      },
    ],
    linkedFeatures: [],
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    decisionFrameworkSettings: {},
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    releasedVariationId: "",
    ...fields,
  });
}

// A flag with its published version 1 and draft version 2.
export async function insertFlag(
  id: string,
  draftStatus: string,
  draftRules: object[],
  project = "",
) {
  const now = new Date();
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    project,
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: now,
    dateUpdated: now,
  });
  const revision = (version: number, status: string, rules: object[]) => ({
    id: `frev_${id}_${version}`,
    organization: ORG_ID,
    featureId: id,
    version,
    baseVersion: 1,
    status,
    createdBy: {
      type: "dashboard",
      id: "u_owner",
      email: "u_owner@test.com",
      name: "u_owner",
    },
    comment: "",
    defaultValue: "false",
    rules,
    environmentsEnabled: { production: true },
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
  await revisions().insertMany([
    revision(1, "published", []),
    revision(2, draftStatus, draftRules),
  ]);
}

export const job = {
  attrs: { data: { experimentId: EXP_ID, organization: ORG_ID } },
} as unknown as Job<{ experimentId: string; organization: string }>;

export const staged = async () =>
  (await experiments().findOne({ id: EXP_ID }))?.nextScheduledStatusUpdate ??
  null;
export const status = async () =>
  (await experiments().findOne({ id: EXP_ID }))?.status;

// Runs the job as if the staged update's time had come.
export async function fire() {
  await experiments().updateOne(
    { id: EXP_ID },
    { $set: { "nextScheduledStatusUpdate.date": new Date(Date.now() - 1000) } },
  );
  await updateSingleExperimentStatus(job);
}

export function dashboardReq<T>(
  body: Record<string, unknown>,
  {
    userId = "u_owner",
    orgDoc = org,
    params = { id: EXP_ID },
  }: {
    userId?: string;
    orgDoc?: OrganizationInterface;
    params?: Record<string, string>;
  } = {},
): T {
  return {
    params,
    body,
    organization: orgDoc,
    userId,
    email: `${userId}@test.com`,
    name: userId,
    query: {},
    headers: {},
    audit: jest.fn(),
  } as unknown as T;
}

// The refusal a start gets while the checklist item `key` is open.
export const checklistRefusal = (key: string) => ({
  code: "checklist_incomplete",
  details: {
    remainingChecklistItems: expect.arrayContaining([
      expect.objectContaining({ key }),
    ]),
  },
});

// The context the controller recorded on its first audit.
export const auditContext = (req: { audit: unknown }) =>
  JSON.parse((req.audit as jest.Mock).mock.calls[0][0].details).context;

export function resSpy() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}
