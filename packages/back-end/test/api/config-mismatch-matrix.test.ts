import mongoose from "mongoose";
import {
  ORG_ID,
  Driver,
  JsonSchema,
  Outcome,
  appDriver,
  insertConfig,
  rest,
  restContext,
  restDriver,
  setReqContext,
} from "./configDraftDrivers";

// Odd edits across a Config family. Each row runs through the app and REST on
// fresh fixtures, and every step must give the expected answer on both.

const field = (key: string, type: string, extra: object = {}) => ({
  key,
  type,
  required: false,
  default: "",
  description: "",
  enum: [],
  ...extra,
});

const connJsonSchema = {
  type: "object",
  properties: { host: { type: "string" }, port: { type: "integer" } },
  required: ["host", "port"],
  additionalProperties: false,
};

const rootSchema = (limitType: string, extra: Record<string, unknown> = {}) =>
  ({
    type: "object",
    required: ["limit"],
    properties: { limit: { type: limitType }, conn: connJsonSchema, ...extra },
  }) as JsonSchema;

const resetFixtures = async () => {
  setReqContext(restContext());
  for (const c of ["configs", "revisions"]) {
    await mongoose.connection
      .collection(c)
      .deleteMany({ organization: ORG_ID });
  }
  await insertConfig({
    key: "root",
    extensible: false,
    schema: {
      type: "object",
      fields: [
        field("limit", "integer", { required: true }),
        field("conn", "string", { jsonSchema: JSON.stringify(connJsonSchema) }),
      ],
    },
    value: JSON.stringify({ limit: 5, conn: { host: "h", port: 1 } }),
    scopedOverrides: [{ config: "root_prod", environments: ["production"] }],
  });
  await insertConfig({
    key: "child",
    parent: "root",
    schema: { type: "object", fields: [field("note", "string")] },
    value: JSON.stringify({ note: "n", limit: 6 }),
  });
  await insertConfig({
    key: "grand",
    parent: "child",
    value: JSON.stringify({ note: "g" }),
  });
  await insertConfig({
    key: "mixA",
    schema: { type: "object", fields: [field("color", "string")] },
    value: JSON.stringify({ color: "red" }),
  });
  await insertConfig({
    key: "mixB",
    schema: { type: "object", fields: [field("color", "integer")] },
    value: JSON.stringify({ color: 1 }),
  });
  await insertConfig({
    key: "composer",
    parent: "root",
    extends: ["mixA"],
    value: JSON.stringify({ color: "blue" }),
  });
  await insertConfig({
    key: "root_prod",
    parent: "root",
    scopedConfig: { parent: "root", environments: ["production"] },
    value: JSON.stringify({ limit: 9 }),
  });
  await insertConfig({
    key: "loose",
    extensible: true,
    schema: { type: "object", fields: [field("a", "integer")] },
  });
  await insertConfig({
    key: "loose_child",
    parent: "loose",
    value: JSON.stringify({ free: 1 }),
  });
};

// "ok", or a fragment the error must contain. `false` accepts any rejection,
// for input each surface's own request validation words differently.
type Expect = "ok" | string | false;
type Row = {
  name: string;
  restOnly?: boolean;
  run: (api: Driver) => Promise<Outcome[]>;
  expect: Expect[];
};

const isDuplicateBranch = "declare the same field on separate branches";
const isCycle = "would create a reference cycle";

const ROWS: Row[] = [
  {
    name: "child re-declares an inherited field with another type",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.schema("child", d, {
          type: "object",
          properties: { note: { type: "string" }, limit: { type: "string" } },
        }),
      ];
    },
    expect: [`with a different definition: "limit"`],
  },
  {
    name: "child re-declares an inherited field identically",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.schema("child", d, {
          type: "object",
          required: ["limit"],
          properties: { note: { type: "string" }, limit: { type: "integer" } },
        }),
        await api.publish("child", d),
      ];
    },
    expect: ["ok", "ok"],
  },
  {
    name: "grandchild sets a wrong type two levels down",
    run: async (api) => {
      const d = await api.open("grand");
      return [await api.value("grand", d, { note: "g", limit: "x" })];
    },
    expect: [`"limit" must be number`],
  },
  {
    name: "grandchild sets its parent's field to the wrong type",
    run: async (api) => {
      const d = await api.open("grand");
      return [await api.value("grand", d, { note: 1 })];
    },
    expect: [`"note" must be string`],
  },
  {
    name: "grandchild sets a key nobody declares",
    run: async (api) => {
      const d = await api.open("grand");
      return [await api.value("grand", d, { note: "g", zzz: 1 })];
    },
    expect: [`"zzz" isn't in the schema`],
  },
  {
    name: "child patches part of a closed nested object",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.value("child", d, { note: "n", conn: { host: "new" } }),
        await api.publish("child", d),
      ];
    },
    expect: ["ok", "ok"],
  },
  {
    name: "child adds a key inside a closed nested object",
    run: async (api) => {
      const d = await api.open("child");
      return [await api.value("child", d, { conn: { host: "x", extra: 1 } })];
    },
    expect: [`"conn/extra" isn't in the schema`],
  },
  {
    name: "composer sets a mixin field to the wrong type",
    run: async (api) => {
      const d = await api.open("composer");
      return [await api.value("composer", d, { color: 5 })];
    },
    expect: [`"color" must be string`],
  },
  {
    name: "composer adds a second mixin that declares the same field",
    run: async (api) => {
      const d = await api.open("composer");
      return [await api.meta("composer", d, { extends: ["mixA", "mixB"] })];
    },
    expect: [isDuplicateBranch],
  },
  {
    name: "child moves under a base that allows extra fields",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.meta("child", d, { parent: "loose" }),
        await api.publish("child", d),
      ];
    },
    expect: ["ok", "ok"],
  },
  {
    name: "grandchild skips the parent that declares its field",
    run: async (api) => {
      const d = await api.open("grand");
      return [await api.meta("grand", d, { parent: "root" })];
    },
    expect: [`"note" isn't in the schema`],
  },
  {
    name: "base takes its own grandchild as parent",
    run: async (api) => {
      const d = await api.open("root");
      return [await api.meta("root", d, { parent: "grand" })];
    },
    expect: [isCycle],
  },
  {
    name: "child mixes in its own descendant",
    run: async (api) => {
      const d = await api.open("child");
      return [await api.meta("child", d, { extends: ["grand"] })];
    },
    expect: [isCycle],
  },
  {
    name: "child turns on extra fields, which only its base decides",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.meta("child", d, { extensible: true }),
        await api.value("child", d, { note: "n", zzz: 1 }),
      ];
    },
    expect: ["ok", `"zzz" isn't in the schema`],
  },
  {
    name: "base retypes a field it and a child set",
    run: async (api) => {
      const d = await api.open("root");
      const steps = [
        await api.schemaAndValue("root", d, rootSchema("string"), {
          limit: "5",
          conn: { host: "h", port: 1 },
        }),
        await api.publish("root", d),
        await api.publish("root", d, { ignoreWarnings: true }),
      ];
      const c = await api.open("child");
      steps.push(await api.value("child", c, { note: "changed", limit: 6 }));
      return steps;
    },
    expect: [
      "ok",
      `"child" (child): has value(s) that no longer match retyped field(s) "limit"`,
      "ok",
      `"limit" must be string`,
    ],
  },
  {
    name: "base takes over a field a leaf child defines with another type",
    run: async (api) => {
      await insertConfig({
        key: "leaf",
        parent: "root",
        schema: { type: "object", fields: [field("region", "string")] },
        value: JSON.stringify({ region: "eu" }),
      });
      const d = await api.open("root");
      const steps = [
        await api.schema(
          "root",
          d,
          rootSchema("integer", { region: { type: "integer" } }),
        ),
        await api.publish("root", d),
        await api.publish("root", d, { ignoreWarnings: true }),
      ];
      const c = await api.open("leaf");
      steps.push(await api.value("leaf", c, { region: "us" }));
      steps.push(await api.value("leaf", c, { region: 2 }));
      return steps;
    },
    expect: [
      "ok",
      `"leaf" (leaf): has value(s) that no longer match retyped field(s) "region"; declares conflicting field(s) "region" that would be dropped`,
      "ok",
      `"region" must be number`,
      "ok",
    ],
  },
  {
    name: "base takes over a field a child with descendants defines",
    run: async (api) => {
      const d = await api.open("root");
      const steps = [
        await api.schema(
          "root",
          d,
          rootSchema("integer", { note: { type: "integer" } }),
        ),
        await api.publish("root", d),
        await api.publish("root", d, { ignoreWarnings: true }),
      ];
      const c = await api.open("child");
      steps.push(await api.value("child", c, { note: "changed", limit: 6 }));
      steps.push(await api.value("child", c, { note: 7, limit: 6 }));
      return steps;
    },
    expect: [
      "ok",
      `"child" (child): has value(s) that no longer match retyped field(s) "note"; declares conflicting field(s) "note" that would be dropped`,
      "ok",
      `"note" must be number`,
      "ok",
    ],
  },
  {
    name: "base removes a field it and its descendants set",
    run: async (api) => {
      const d = await api.open("root");
      return [
        await api.schemaAndValue(
          "root",
          d,
          { type: "object", properties: { conn: connJsonSchema } },
          { conn: { host: "h", port: 1 } },
        ),
        await api.publish("root", d),
      ];
    },
    expect: ["ok", `"child" (child): overrides removed field(s) "limit"`],
  },
  {
    name: "base adds a required field without a value",
    run: async (api) => {
      const d = await api.open("root");
      return [
        await api.schema("root", d, {
          ...rootSchema("integer", { tier: { type: "integer" } }),
          required: ["limit", "tier"],
        }),
        await api.publish("root", d),
      ];
    },
    expect: ["ok", `"tier" is required`],
  },
  {
    name: "override sets a nested field to the wrong type",
    run: async (api) => {
      const d = await api.open("root_prod");
      return [await api.value("root_prod", d, { conn: { port: "x" } })];
    },
    expect: [`"conn/port" must be integer`],
  },
  {
    name: "override sets a key nobody declares",
    run: async (api) => {
      const d = await api.open("root_prod");
      return [await api.value("root_prod", d, { zzz: 1 })];
    },
    expect: [`"zzz" isn't in the schema`],
  },
  {
    name: "override sets a fractional integer",
    run: async (api) => {
      const d = await api.open("root_prod");
      return [await api.value("root_prod", d, { limit: 1.5 })];
    },
    expect: [`"limit" must be an integer`],
  },
  {
    name: "base stops allowing extra fields its child uses",
    run: async (api) => {
      const d = await api.open("loose");
      return [
        await api.meta("loose", d, { extensible: false }),
        await api.publish("loose", d),
        await api.publish("loose", d, { ignoreWarnings: true }),
      ];
    },
    expect: ["ok", `sets "free"`, "ok"],
  },
  {
    name: "a mixin retypes a field its composer sets",
    run: async (api) => {
      const d = await api.open("mixA");
      return [
        await api.schemaAndValue(
          "mixA",
          d,
          { type: "object", properties: { color: { type: "integer" } } },
          { color: 1 },
        ),
        await api.publish("mixA", d),
        await api.publish("mixA", d, { ignoreWarnings: true }),
      ];
    },
    expect: [
      "ok",
      `"composer" (composer): has value(s) that no longer match retyped field(s) "color"`,
      "ok",
    ],
  },
  {
    name: "child points $extends at a Config",
    run: async (api) => {
      const d = await api.open("child");
      return [
        await api.value("child", d, {
          note: "n",
          $extends: ["@config:mixA"],
        }),
      ];
    },
    expect: [`Invalid "$extends" entry "@config:mixA"`],
  },
  {
    name: "child drops its schema but keeps a value for it",
    run: async (api) => {
      const d = await api.open("child");
      return [await api.schema("child", d, { type: "object", properties: {} })];
    },
    expect: [`"note" isn't in the schema`],
  },
  {
    name: "draft deletes a key only live has gained since",
    run: async (api) => {
      const d = await api.open("child");
      await mongoose.connection
        .collection("configs")
        .updateOne(
          { organization: ORG_ID, key: "child" },
          { $set: { value: JSON.stringify({ note: "n", limit: 6, b: 2 }) } },
        );
      return [await api.removeProperty("child", d, "b")];
    },
    expect: [`No property "b"`],
  },
  {
    name: "value is an array",
    run: async (api) => {
      const d = await api.open("child");
      return [await api.value("child", d, [1, 2])];
    },
    expect: [false],
  },
  {
    name: "grandchild's open draft after its parent retypes the field",
    run: async (api) => {
      const g = await api.open("grand");
      const steps = [await api.value("grand", g, { note: "g2" })];
      const c = await api.open("child");
      steps.push(
        await api.schemaAndValue(
          "child",
          c,
          { type: "object", properties: { note: { type: "integer" } } },
          { note: 1, limit: 6 },
        ),
        await api.publish("child", c),
        await api.publish("child", c, { ignoreWarnings: true }),
        await api.publish("grand", g),
      );
      return steps;
    },
    expect: [
      "ok",
      "ok",
      `"grand" (grand): has value(s) that no longer match retyped field(s) "note"`,
      "ok",
      `"note" must be number`,
    ],
  },
  {
    name: "REST declares a new key on a grandchild when asked",
    restOnly: true,
    run: async () => {
      const v = String(
        (await rest("post", "grand")).body.revision?.version ?? "",
      );
      return [
        await rest("put", `grand/${v}/value`, {
          value: { note: "g", zzz: 1 },
          inferUndeclaredFields: true,
        }),
        await rest("post", `grand/${v}/publish`),
      ];
    },
    expect: ["ok", "ok"],
  },
];

const answer = (o: Outcome) => (o.ok ? "ok" : o.text);
const matches = (o: Outcome, e: Expect) =>
  e === "ok" ? o.ok : !o.ok && (e === false || o.text.includes(e));

describe("Config mismatch matrix", () => {
  beforeEach(resetFixtures);

  it.each(ROWS)("$name", async ({ run, expect: expected, restOnly }) => {
    for (const api of restOnly ? [restDriver] : [appDriver, restDriver]) {
      await resetFixtures();
      const outcomes = await run(api);
      expect(
        outcomes.map((o, i) =>
          matches(o, expected[i]) ? expected[i] : answer(o),
        ),
      ).toEqual(expected);
    }
  });
});
