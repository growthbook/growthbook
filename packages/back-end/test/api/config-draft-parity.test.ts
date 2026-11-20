import mongoose from "mongoose";
import {
  ORG_ID,
  JsonSchema,
  appDriver,
  expectOk,
  insertConfig,
  liveValue,
  rest,
  restContext,
  restDriver,
  setReqContext,
} from "./configDraftDrivers";

// Every Config draft scenario runs through the app's routes and the REST API,
// which must accept, reject and publish the same things.

const requiredLimit: JsonSchema = {
  type: "object",
  required: ["limit"],
  properties: { limit: { type: "integer" } },
};

beforeEach(async () => {
  setReqContext(restContext());
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
  await insertConfig({ key: "open", extensible: true });
  await insertConfig({
    key: "open_child",
    parent: "open",
    value: JSON.stringify({ extra: 2 }),
  });
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

describe.each([
  { surface: "app", api: appDriver },
  { surface: "REST", api: restDriver },
])("Config drafts through the $surface", ({ api }) => {
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

  it("warns before disallowing extra fields a child still sets", async () => {
    const draft = await api.open("open");
    expectOk(await api.meta("open", draft, { extensible: false }));
    const warned = await api.publish("open", draft);
    expect(warned.ok).toBe(false);
    expect(warned.text).toContain(
      `sets "extra", which no schema declares and extra fields would no longer allow`,
    );
    expectOk(await api.publish("open", draft, { ignoreWarnings: true }));
  });

  it("blocks publishing without a required field, naming it", async () => {
    const draft = await api.open("strict");
    expectOk(await api.schema("strict", draft, requiredLimit));
    const outcome = await api.publish("strict", draft);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain(`"limit" is required`);
  });
});

// The app has no equivalent: its editor adds new keys to the schema text the
// author is editing, so the change is visible before it saves.
describe("inferring undeclared fields from a REST value", () => {
  const putValue = (draft: string, body: Record<string, unknown>) =>
    rest("put", `base/${draft}/value`, body);

  it("rejects an undeclared key unless asked to infer a field", async () => {
    const draft = await restDriver.open("base");
    const value = { limit: 1, color: "red" };
    expect((await putValue(draft, { value })).text).toContain(
      `"color" isn't in the schema`,
    );
    const declared = await putValue(draft, {
      value,
      inferUndeclaredFields: true,
    });
    expectOk(declared);
    expect(
      (declared.body as { warnings?: { code: string; path?: string }[] })
        .warnings,
    ).toEqual([
      expect.objectContaining({ code: "inferred-field", path: "color" }),
    ]);
    expectOk(await restDriver.publish("base", draft));
    expect(await liveValue("base")).toEqual(value);
    // Inferred fields are optional, so a later value can leave them out.
    const next = await restDriver.open("base");
    expectOk(await putValue(next, { value: { limit: 2 } }));
    expectOk(await restDriver.publish("base", next));
  });

  it("never changes a field the schema already declares", async () => {
    const draft = await restDriver.open("base");
    const res = await putValue(draft, {
      value: { limit: "many" },
      inferUndeclaredFields: true,
    });
    expect(res.ok).toBe(false);
    expect(res.text).toContain(`"limit" must be number`);
  });
});
