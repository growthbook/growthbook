import request from "supertest";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import {
  putConfig,
  putConfigProperty,
} from "back-end/src/routers/config/config.controller";
import { postMerge } from "back-end/src/routers/revision/revision.controller";
import { resolveConfigSchemaSource } from "back-end/src/api/configs/validations";
import { setupApp } from "./api.setup";

// Every Config draft scenario runs through the app's routes and the REST API,
// which must accept, reject and publish the same things.

const ORG_ID = "org_config_draft_parity";
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

type JsonSchema = Record<string, unknown>;
type Outcome = { ok: boolean; text: string };
type Driver = {
  open: (key: string) => Promise<string>;
  schema: (key: string, draft: string, schema: JsonSchema) => Promise<Outcome>;
  value: (key: string, draft: string, value: unknown) => Promise<Outcome>;
  property: (
    key: string,
    draft: string,
    property: string,
    value: unknown,
  ) => Promise<Outcome>;
  meta: (
    key: string,
    draft: string,
    meta: { extends?: string[]; extensible?: boolean },
  ) => Promise<Outcome>;
  publish: (key: string, draft: string) => Promise<Outcome>;
};

const { app, setReqContext } = setupApp();

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

const appDriver: Driver = {
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
  property: (key, draft, property, value) =>
    callApp(
      putConfigProperty,
      { id: `cfg_${key}` },
      { property, value },
      { revisionId: draft },
    ),
  meta: (key, draft, meta) =>
    callApp(putConfig, { id: `cfg_${key}` }, meta, { revisionId: draft }),
  publish: (key, draft) => callApp(postMerge, { id: draft }, {}),
};

const rest = async (
  method: "post" | "put",
  path: string,
  body: Record<string, unknown> = {},
): Promise<Outcome & { body: { revision?: { version: number } } }> => {
  const url = `/api/v1/configs-revisions/${path}`;
  const req =
    method === "post" ? request(app).post(url) : request(app).put(url);
  const res = await req.send(body).set("Authorization", "Bearer foo");
  const gates: { messages: string[] }[] = res.body.gates ?? [];
  return {
    ok: res.status === 200,
    text: [res.body.message, ...gates.flatMap((g) => g.messages)].join("\n"),
    body: res.body,
  };
};

const restDriver: Driver = {
  open: async (key) =>
    String((await rest("post", key)).body.revision?.version ?? ""),
  schema: (key, draft, schema) =>
    rest("put", `${key}/${draft}/schema`, {
      schema: { type: "json-schema", value: schema },
    }),
  value: (key, draft, value) => rest("put", `${key}/${draft}/value`, { value }),
  property: (key, draft, property, value) =>
    rest("put", `${key}/${draft}/property`, { property, value }),
  meta: (key, draft, meta) => rest("put", `${key}/${draft}/metadata`, meta),
  publish: (key, draft) => rest("post", `${key}/${draft}/publish`),
};

const insertConfig = (doc: Record<string, unknown>) =>
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

const liveValue = async (key: string) =>
  JSON.parse(
    (
      await mongoose.connection
        .collection("configs")
        .findOne({ organization: ORG_ID, key })
    )?.value ?? "null",
  );

const requiredLimit: JsonSchema = {
  type: "object",
  required: ["limit"],
  properties: { limit: { type: "integer" } },
};

describe.each([
  { surface: "app", api: appDriver },
  { surface: "REST", api: restDriver },
])("Config drafts through the $surface", ({ api }) => {
  beforeEach(async () => {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_test" },
        role: "admin",
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
    for (const c of ["configs", "revisions"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    // Live has no schema and allows no extra fields, so any key fails against it.
    await insertConfig({ key: "strict", extensible: false });
    await insertConfig({
      key: "base",
      extensible: false,
      schema: {
        type: "object",
        fields: [
          {
            key: "limit",
            type: "integer",
            required: true,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
      scopedOverrides: [{ config: "base_prod", environments: ["production"] }],
    });
    await insertConfig({ key: "child", parent: "base" });
    await insertConfig({
      key: "base_prod",
      parent: "base",
      scopedConfig: { parent: "base", environments: ["production"] },
    });
    await insertConfig({
      key: "mix",
      schema: {
        type: "object",
        fields: [
          {
            key: "color",
            type: "string",
            required: true,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
    });
  });

  const expectOk = (outcome: Outcome) =>
    expect({ ok: outcome.ok, text: outcome.ok ? "" : outcome.text }).toEqual({
      ok: true,
      text: "",
    });

  it("publishes a value saved after its schema", async () => {
    const draft = await api.open("strict");
    expectOk(await api.schema("strict", draft, requiredLimit));
    expectOk(await api.value("strict", draft, { limit: 5 }));
    expectOk(await api.publish("strict", draft));
    expect(await liveValue("strict")).toEqual({ limit: 5 });
  });

  it("publishes a property saved after its schema", async () => {
    const draft = await api.open("strict");
    expectOk(await api.schema("strict", draft, requiredLimit));
    expectOk(await api.property("strict", draft, "limit", 7));
    expectOk(await api.publish("strict", draft));
    expect(await liveValue("strict")).toEqual({ limit: 7 });
  });

  it("publishes extra fields once the draft allows them", async () => {
    const draft = await api.open("strict");
    expectOk(await api.meta("strict", draft, { extensible: true }));
    expectOk(await api.value("strict", draft, { extra: 1 }));
    expectOk(await api.publish("strict", draft));
    expect(await liveValue("strict")).toEqual({ extra: 1 });
  });

  it("publishes a value for a mixin the draft adds", async () => {
    const draft = await api.open("base");
    expectOk(await api.meta("base", draft, { extends: ["mix"] }));
    expectOk(await api.value("base", draft, { limit: 1, color: "red" }));
    expectOk(await api.publish("base", draft));
    expect(await liveValue("base")).toEqual({ limit: 1, color: "red" });
  });

  it("publishes a child's own field with an inherited one", async () => {
    const draft = await api.open("child");
    expectOk(
      await api.schema("child", draft, {
        type: "object",
        properties: { note: { type: "string" } },
      }),
    );
    expectOk(await api.value("child", draft, { limit: 2, note: "x" }));
    expectOk(await api.publish("child", draft));
    expect(await liveValue("child")).toEqual({ limit: 2, note: "x" });
  });

  it("publishes an environment override's inherited field", async () => {
    const draft = await api.open("base_prod");
    expectOk(await api.value("base_prod", draft, { limit: 3 }));
    expectOk(await api.publish("base_prod", draft));
    expect(await liveValue("base_prod")).toEqual({ limit: 3 });
  });

  it.each([
    {
      name: "a key its own schema lacks",
      key: "strict",
      value: { limit: 1, x: 1 },
      message: `"x" isn't in the schema`,
    },
    {
      name: "a wrong inherited type",
      key: "child",
      value: { limit: "1" },
      message: `"limit" must be number`,
    },
    {
      name: "a key the base lacks",
      key: "base_prod",
      value: { x: 1 },
      message: `"x" isn't in the schema`,
    },
  ])("rejects $name", async ({ key, value, message }) => {
    const draft = await api.open(key);
    if (key === "strict") {
      expectOk(await api.schema(key, draft, requiredLimit));
    }
    const outcome = await api.value(key, draft, value);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain(message);
  });

  it("blocks publishing without a required field, naming it", async () => {
    const draft = await api.open("strict");
    expectOk(await api.schema("strict", draft, requiredLimit));
    const outcome = await api.publish("strict", draft);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain(`"limit" is required`);
  });
});
