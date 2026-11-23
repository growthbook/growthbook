import request from "supertest";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import {
  deleteConfigProperty,
  putConfig,
  putConfigProperty,
} from "back-end/src/routers/config/config.controller";
import { postMerge } from "back-end/src/routers/revision/revision.controller";
import { resolveConfigSchemaSource } from "back-end/src/api/configs/validations";
import { setupApp } from "./api.setup";

// Drives Config drafts through the app's routes and the REST API with the same
// calls, so a test can hold the two surfaces to the same answers.

export const ORG_ID = "org_config_draft_parity";
const org = {
  id: ORG_ID,
  name: "Config Draft Parity",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

export type JsonSchema = Record<string, unknown>;
export type Outcome = { ok: boolean; text: string };
export type Driver = {
  open: (key: string) => Promise<string>;
  schema: (key: string, draft: string, schema: JsonSchema) => Promise<Outcome>;
  value: (key: string, draft: string, value: unknown) => Promise<Outcome>;
  // One write carrying both, as the app's JSON editor sends them.
  schemaAndValue: (
    key: string,
    draft: string,
    schema: JsonSchema,
    value: unknown,
  ) => Promise<Outcome>;
  property: (
    key: string,
    draft: string,
    property: string,
    value: unknown,
  ) => Promise<Outcome>;
  removeProperty: (
    key: string,
    draft: string,
    property: string,
  ) => Promise<Outcome>;
  meta: (
    key: string,
    draft: string,
    meta: { parent?: string; extends?: string[]; extensible?: boolean },
  ) => Promise<Outcome>;
  publish: (
    key: string,
    draft: string,
    opts?: { ignoreWarnings?: boolean },
  ) => Promise<Outcome>;
};

export const { app, setReqContext } = setupApp();

// Called the way Express calls a route: with `next` as the third argument.
const callApp = async (
  handler: (req: never, res: Response, next: () => void) => Promise<unknown>,
  params: Record<string, string>,
  body: Record<string, unknown>,
  query: Record<string, string> = {},
): Promise<Outcome & { body?: { revision?: { id: string } } }> => {
  let status = 200;
  let payload: { revision?: { id: string } } | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(data: typeof payload) {
      payload = data;
      return this;
    },
  } as unknown as Response;
  try {
    await handler(
      {
        params,
        body,
        query,
        organization: org,
        userId: "u_admin",
        email: "a@t.co",
        name: "A",
        headers: {},
      } as never,
      res,
      () => undefined,
    );
    return { ok: status < 300, text: JSON.stringify(payload), body: payload };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
};

export const appDriver: Driver = {
  open: async (key) => {
    const res = await callApp(
      putConfig,
      { id: `cfg_${key}` },
      {},
      { forceCreateRevision: "1" },
    );
    return res.body?.revision?.id ?? "";
  },
  schema: (key, draft, schema) =>
    callApp(
      putConfig,
      { id: `cfg_${key}` },
      {
        schema: resolveConfigSchemaSource({
          source: { type: "json-schema", value: schema },
        }).schema,
      },
      { revisionId: draft },
    ),
  value: (key, draft, value) =>
    callApp(
      putConfig,
      { id: `cfg_${key}` },
      { value: JSON.stringify(value) },
      { revisionId: draft },
    ),
  schemaAndValue: (key, draft, schema, value) =>
    callApp(
      putConfig,
      { id: `cfg_${key}` },
      {
        schema: resolveConfigSchemaSource({
          source: { type: "json-schema", value: schema },
        }).schema,
        value: JSON.stringify(value),
      },
      { revisionId: draft },
    ),
  property: (key, draft, property, value) =>
    callApp(
      putConfigProperty,
      { id: `cfg_${key}` },
      { property, value },
      { revisionId: draft },
    ),
  removeProperty: (key, draft, property) =>
    callApp(
      deleteConfigProperty,
      { id: `cfg_${key}` },
      { property },
      { revisionId: draft },
    ),
  meta: (key, draft, meta) =>
    callApp(putConfig, { id: `cfg_${key}` }, meta, { revisionId: draft }),
  publish: (key, draft, opts) =>
    callApp(
      postMerge,
      { id: draft },
      {},
      opts?.ignoreWarnings ? { ignoreWarnings: "true" } : {},
    ),
};

// The REST harness reads override flags from the context's own request.
export const restContext = (body: Record<string, unknown> = {}) =>
  new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {}, body } as unknown as Request,
  });

export const rest = async (
  method: "post" | "put" | "delete",
  path: string,
  body: Record<string, unknown> = {},
): Promise<Outcome & { body: { revision?: { version: number } } }> => {
  const url = `/api/v1/configs-revisions/${path}`;
  const req =
    method === "post"
      ? request(app).post(url)
      : method === "put"
        ? request(app).put(url)
        : request(app).delete(url);
  const res = await req.send(body).set("Authorization", "Bearer foo");
  const gates: { messages: string[] }[] = res.body.gates ?? [];
  return {
    ok: res.status === 200,
    text: [res.body.message, ...gates.flatMap((g) => g.messages)].join("\n"),
    body: res.body,
  };
};

export const restDriver: Driver = {
  open: async (key) =>
    String((await rest("post", key)).body.revision?.version ?? ""),
  schema: (key, draft, schema) =>
    rest("put", `${key}/${draft}/schema`, {
      schema: { type: "json-schema", value: schema },
    }),
  value: (key, draft, value) => rest("put", `${key}/${draft}/value`, { value }),
  schemaAndValue: (key, draft, schema, value) =>
    rest("put", `${key}/${draft}/schema`, {
      schema: { type: "json-schema", value: schema },
      value,
    }),
  property: (key, draft, property, value) =>
    rest("put", `${key}/${draft}/property`, { property, value }),
  removeProperty: (key, draft, property) =>
    rest(
      "delete",
      `${key}/${draft}/property?property=${encodeURIComponent(property)}`,
    ),
  meta: (key, draft, meta) => rest("put", `${key}/${draft}/metadata`, meta),
  publish: async (key, draft, opts) => {
    if (!opts?.ignoreWarnings) return rest("post", `${key}/${draft}/publish`);
    setReqContext(restContext({ ignoreWarnings: true }));
    try {
      return await rest("post", `${key}/${draft}/publish`, {
        ignoreWarnings: true,
      });
    } finally {
      setReqContext(restContext());
    }
  },
};

export const insertConfig = (doc: Record<string, unknown>) =>
  mongoose.connection.collection("configs").insertOne({
    id: `cfg_${doc.key}`,
    organization: ORG_ID,
    name: doc.key,
    owner: "",
    project: "",
    value: "{}",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...doc,
  });

export const liveValue = async (key: string) =>
  JSON.parse(
    (
      await mongoose.connection
        .collection("configs")
        .findOne({ organization: ORG_ID, key })
    )?.value ?? "null",
  );

export const expectOk = (outcome: Outcome) =>
  expect({ ok: outcome.ok, text: outcome.ok ? "" : outcome.text }).toEqual({
    ok: true,
    text: "",
  });
