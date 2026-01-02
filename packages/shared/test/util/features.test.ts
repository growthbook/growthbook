import {
  FeatureInterface,
  FeatureRule,
  SchemaField,
  SimpleSchema,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { OrganizationSettings, RequireReview } from "shared/types/organization";
import {
  validateFeatureValue,
  getValidation,
  validateJSONFeatureValue,
  autoMerge,
  RulesAndValues,
  MergeConflict,
  validateCondition,
  checkEnvironmentsMatch,
  checkIfRevisionNeedsReview,
  resetReviewOnChange,
  simpleToJSONSchema,
  inferSchemaField,
  inferSchemaFields,
  inferSimpleSchemaFromValue,
} from "../../src/util";

const feature: FeatureInterface = {
  dateCreated: new Date("2020-04-20"),
  dateUpdated: new Date("2020-04-20"),
  defaultValue: "true",
  environmentSettings: {},
  id: "feature-123",
  organization: "123",
  owner: "adnan",
  valueType: "boolean",
  version: 1,
};

const exampleJsonSchema = {
  type: "object",
  properties: {
    test: {
      type: "string",
    },
  },
};
const rules: Record<string, FeatureRule[]> = {
  dev: [
    {
      description: "test",
      id: "test",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
  prod: [
    {
      description: "test",
      id: "test",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
};
const changedRules: Record<string, FeatureRule[]> = {
  ...rules,
  prod: [
    ...rules.prod,

    {
      description: "test1",
      id: "test1",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
};
const baseRevision: FeatureRevisionInterface = {
  featureId: feature.id,
  organization: feature.organization,
  baseVersion: 0,
  version: 0,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datePublished: null,
  publishedBy: null,
  createdBy: null,
  comment: "",
  status: "draft",
  defaultValue: "",
  rules: rules,
};

const revision: FeatureRevisionInterface = {
  featureId: feature.id,
  organization: feature.organization,
  baseVersion: 0,
  version: 1,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datePublished: null,
  publishedBy: null,
  createdBy: null,
  comment: "",
  status: "draft",
  defaultValue: "",
  rules: changedRules,
};

describe("autoMerge", () => {
  it("Auto merges when there are no conflicts", () => {
    const base: RulesAndValues = {
      defaultValue: "base",
      rules: {
        dev: [],
        prod: [],
      },
      version: 4,
    };
    const live: RulesAndValues = {
      defaultValue: "base",
      rules: {
        dev: [],
        prod: [
          {
            type: "force",
            description: "",
            id: "liveForce",
            value: "force",
          },
        ],
      },
      version: 6,
    };
    const revision: RulesAndValues = {
      defaultValue: "revision",
      rules: {
        dev: [
          {
            type: "force",
            description: "",
            id: "revisionForce",
            value: "force",
          },
        ],
        prod: [],
      },
      version: 5,
    };

    expect(autoMerge(live, base, revision, ["dev", "prod"], {})).toEqual({
      success: true,
      conflicts: [],
      result: {
        defaultValue: revision.defaultValue,
        rules: {
          dev: revision.rules["dev"],
        },
      },
    });
  });
  it("Auto merges when live and base are the same revision", () => {
    const base: RulesAndValues = {
      defaultValue: "base",
      rules: {
        dev: [],
        prod: [],
      },
      version: 4,
    };
    const revision: RulesAndValues = {
      defaultValue: "revision",
      rules: {
        dev: [
          {
            type: "force",
            description: "",
            id: "revisionForce",
            value: "force",
          },
        ],
      },
      version: 5,
    };

    expect(autoMerge(base, base, revision, ["dev", "prod"], {})).toEqual({
      success: true,
      conflicts: [],
      result: {
        defaultValue: revision.defaultValue,
        rules: {
          dev: revision.rules["dev"],
        },
      },
    });
  });
  it("Handles merge conflicts", () => {
    const base: RulesAndValues = {
      defaultValue: "base",
      rules: {
        dev: [],
        prod: [],
      },
      version: 4,
    };
    const live: RulesAndValues = {
      defaultValue: "live",
      rules: {
        dev: [],
        prod: [
          {
            type: "force",
            description: "",
            id: "liveForce",
            value: "force",
          },
        ],
      },
      version: 6,
    };
    const revision: RulesAndValues = {
      defaultValue: "revision",
      rules: {
        dev: [
          {
            type: "force",
            description: "",
            id: "revisionForce",
            value: "force",
          },
        ],
        prod: [
          {
            type: "force",
            description: "",
            id: "revisionForce",
            value: "force",
          },
        ],
      },
      version: 5,
    };

    const defaultValueConflict: MergeConflict = {
      key: "defaultValue",
      name: "Default Value",
      resolved: false,
      base: "base",
      live: "live",
      revision: "revision",
    };
    const prodConflict: MergeConflict = {
      key: "rules.prod",
      name: "Rules - prod",
      resolved: false,
      base: JSON.stringify(base.rules["prod"], null, 2),
      live: JSON.stringify(live.rules["prod"], null, 2),
      revision: JSON.stringify(revision.rules["prod"], null, 2),
    };

    expect(autoMerge(live, base, revision, ["dev", "prod"], {})).toEqual({
      success: false,
      conflicts: [defaultValueConflict, prodConflict],
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        "rules.prod": "discard",
      }),
    ).toEqual({
      success: false,
      conflicts: [
        {
          ...defaultValueConflict,
        },
        {
          ...prodConflict,
          resolved: true,
        },
      ],
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        "rules.prod": "discard",
        defaultValue: "discard",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...prodConflict,
          resolved: true,
        },
      ],
      result: {
        rules: {
          dev: revision.rules["dev"],
        },
      },
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        "rules.prod": "discard",
        defaultValue: "overwrite",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...prodConflict,
          resolved: true,
        },
      ],
      result: {
        defaultValue: revision.defaultValue,
        rules: {
          dev: revision.rules["dev"],
        },
      },
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        "rules.prod": "overwrite",
        defaultValue: "overwrite",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...prodConflict,
          resolved: true,
        },
      ],
      result: {
        defaultValue: revision.defaultValue,
        rules: {
          dev: revision.rules["dev"],
          prod: revision.rules["prod"],
        },
      },
    });
  });
});

describe("simpleToJSONSchema", () => {
  const simpleSchema: SimpleSchema = {
    type: "object",
    fields: [
      {
        key: "a_string",
        type: "string",
        description: "foo",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 256,
      },
      {
        key: "a_integer",
        type: "integer",
        description: "",
        required: false,
        enum: [],
        default: "",
        min: -10,
        max: -1,
      },
      {
        key: "a_float",
        type: "float",
        description: "",
        required: true,
        enum: ["0.5", "0.75", "1.5", "3.0"],
        default: "0.5",
        min: 0,
        max: 25,
      },
      {
        key: "a_boolean",
        type: "boolean",
        description: "",
        required: false,
        enum: [],
        default: "",
        min: 5,
        max: 10,
      },
    ],
  };
  const expectedProperties = {
    a_string: {
      type: "string",
      description: "foo",
      minLength: 0,
      maxLength: 256,
    },
    a_integer: {
      type: "number",
      format: "number",
      minimum: -10,
      maximum: -1,
      multipleOf: 1,
    },
    a_float: {
      type: "number",
      enum: [0.5, 0.75, 1.5, 3],
      default: 0.5,
    },
    a_boolean: {
      type: "boolean",
    },
  };

  it("converts object", () => {
    expect(JSON.parse(simpleToJSONSchema(simpleSchema))).toEqual({
      type: "object",
      properties: expectedProperties,
      required: ["a_string", "a_float"],
      additionalProperties: false,
    });
  });
  it("converts array of objects", () => {
    const arraySchema: SimpleSchema = { ...simpleSchema, type: "object[]" };
    expect(JSON.parse(simpleToJSONSchema(arraySchema))).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: expectedProperties,
        required: ["a_string", "a_float"],
        additionalProperties: false,
      },
    });
  });
  it("converts primitive", () => {
    const primitiveSchema: SimpleSchema = {
      ...simpleSchema,
      type: "primitive",
    };
    expect(JSON.parse(simpleToJSONSchema(primitiveSchema))).toEqual(
      expectedProperties.a_string,
    );
  });
  it("converts array of primitives", () => {
    const primitiveArraySchema: SimpleSchema = {
      ...simpleSchema,
      type: "primitive[]",
    };
    expect(JSON.parse(simpleToJSONSchema(primitiveArraySchema))).toEqual({
      type: "array",
      items: expectedProperties.a_string,
    });
  });

  it("throws an error if type is invalid", () => {
    const invalidSchema = { ...simpleSchema, type: "invalid" };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid simple schema type");
  });

  it("throws an error if min is greater than max", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: 10,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws an error if min is greater than max for strings", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "string",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: 10,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws an error if min is less than zero for strings", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "string",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: -1,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws if default value not in enum", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "float",
          description: "",
          required: true,
          enum: ["0.5", "0.75", "1.5", "3.0"],
          default: "0.25",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '0.25' not in enum for field invalid");
  });

  it("throws if fields are empty", () => {
    const invalidSchema = { ...simpleSchema, fields: [] };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Schema must have at least 1 field");
  });

  it("throws if default value is outside of min/max", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "100",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '100' is greater than max value for field invalid");
  });

  it("ignores min/max for enums", () => {
    const validSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "valid",
          type: "string",
          description: "",
          required: true,
          enum: ["a", "b", "cdefghijklm"],
          min: 2,
          max: 4,
        },
      ],
    };
    expect(JSON.parse(simpleToJSONSchema(validSchema as SimpleSchema))).toEqual(
      {
        type: "object",
        properties: {
          ...expectedProperties,
          valid: {
            type: "string",
            enum: ["a", "b", "cdefghijklm"],
          },
        },
        required: ["a_string", "a_float", "valid"],
        additionalProperties: false,
      },
    );
  });

  it("throws an error when integer value is a float", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "0.5",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '0.5' is not an integer for field invalid");
  });
});

describe("inferSchemaField", () => {
  it("Infers primitive values in isolation", () => {
    expect(inferSchemaField("test", "t")).toEqual({
      type: "string",
      key: "t",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 64,
    });
    expect(inferSchemaField(123, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });
    expect(inferSchemaField(-0.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -999,
      max: 999,
    });
    expect(inferSchemaField(true, "")).toEqual({
      type: "boolean",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 0,
    });
  });
  it("Takes a bigger max/min if the value exceeds the current max/min", () => {
    expect(inferSchemaField(1000, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 1000,
    });
    expect(inferSchemaField(-1000, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -1000,
      max: 999,
    });
    expect(inferSchemaField(1000.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 1000.5,
    });
    expect(inferSchemaField(-1000.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -1000.5,
      max: 999,
    });

    // Does the same for max string length
    expect(inferSchemaField("a".repeat(300), "")).toEqual({
      type: "string",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 300,
    });
  });
  it("Infers primitive values given an existing schema", () => {
    // Existing string with long max length should keep the max length
    expect(
      inferSchemaField("test", "h", {
        type: "string",
        key: "h",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 256,
      }),
    ).toEqual({
      type: "string",
      key: "h",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 256,
    });

    // Existing integer with a min value should keep the min value
    expect(
      inferSchemaField(123, "", {
        type: "integer",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: -999,
        max: 999,
      }),
    ).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -999,
      max: 999,
    });
  });

  it("Upgrades from integer to float", () => {
    // Existing float with a new integer value should keep the float type
    expect(
      inferSchemaField(123, "", {
        type: "float",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });

    // Existing integer type, given a new float value, should change the type to float
    expect(
      inferSchemaField(123.5, "", {
        type: "integer",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });
  });

  it("throws when the types change in an incompatible way", () => {
    // Changing from string to integer should throw
    expect(() =>
      inferSchemaField(123, "", {
        type: "string",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toThrowError("Conflicting types");
  });

  it("throws when an unknown type is encountered", () => {
    // Try to infer type of an object (only primitives are supported)
    expect(() => inferSchemaField({ a: 1 }, "")).toThrowError(
      "Invalid value type: object",
    );
  });

  it("returns early when value is null or undefined", () => {
    expect(inferSchemaField(null, "")).toEqual(undefined);
    expect(inferSchemaField(undefined, "")).toEqual(undefined);

    // If given an existing schema, should return that
    const schema: SchemaField = {
      type: "string",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    };
    expect(inferSchemaField(null, "", schema)).toEqual(schema);
    expect(inferSchemaField(undefined, "", schema)).toEqual(schema);
  });
});

describe("inferSchemaFields", () => {
  // structuredClone missing from our jest version
  // This is a hack, but should work since we aren't using Dates or other non-JSON types
  const structuredClone = (obj: unknown) => JSON.parse(JSON.stringify(obj));
  it("Infers object fields in isolation", () => {
    const obj = {
      a_string: "test",
      a_integer: 123,
    };
    expect([...inferSchemaFields(obj).entries()]).toEqual([
      ["a_string", inferSchemaField("test", "a_string")],
      ["a_integer", inferSchemaField(123, "a_integer")],
    ]);
  });
  it("Infers object fields given an existing schema", () => {
    const obj = {
      a_string: "test",
      a_float: -50,
    };
    const existing_float_schema = inferSchemaField(
      256.1,
      "a_float",
    ) as SchemaField;
    const existing_str_schema = inferSchemaField(
      "test",
      "a_string",
    ) as SchemaField;
    const existing = new Map([
      ["a_float", structuredClone(existing_float_schema)],
      ["a_string", structuredClone(existing_str_schema)],
    ]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_float", inferSchemaField(-50, "a_float", existing_float_schema)],
      ["a_string", inferSchemaField("test", "a_string")],
    ]);
  });
  it("Sets required to false when a field is missing from existing schema", () => {
    // Field missing from existing schema
    const obj = {
      a_string: "test",
      a_integer: 123,
    };
    const existing_int = inferSchemaField(50, "a_integer") as SchemaField;
    const existing = new Map([["a_integer", structuredClone(existing_int)]]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_integer", inferSchemaField(123, "a_integer", existing_int)],
      [
        "a_string",
        { ...inferSchemaField("test", "a_string"), required: false },
      ],
    ]);
  });
  it("Sets required to false when a field is missing from the new schema", () => {
    // Field missing from new schema
    const obj = {
      a_string: "test",
    };
    const existing_str = inferSchemaField("test", "a_string") as SchemaField;
    const existing_int = inferSchemaField(50, "a_integer") as SchemaField;
    const existing = new Map([
      // Need to clone since the function mutates the arguments
      ["a_integer", structuredClone(existing_int)],
      ["a_string", structuredClone(existing_str)],
    ]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_integer", { ...existing_int, required: false }],
      ["a_string", existing_str],
    ]);
  });
});

describe("inferSimpleSchemaFromValue", () => {
  it("Infers a primitive value", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify("test"))).toEqual({
      type: "primitive",
      fields: [inferSchemaField("test", "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(123))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(123, "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(-0.5))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(-0.5, "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(false))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(false, "")],
    });
  });
  it("Returns generic schema when value is null, undefined, or invalid JSON", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify(null))).toEqual({
      type: "object",
      fields: [],
    });
    expect(inferSimpleSchemaFromValue("not json")).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Inferes a primitive array", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify(["test", "test2"])),
    ).toEqual({
      type: "primitive[]",
      fields: [inferSchemaField("test", "")],
    });
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify([null, null, 123, 456, 1000, 26.5, -50]),
      ),
    ).toEqual({
      type: "primitive[]",
      fields: [{ ...inferSchemaField(1000, ""), min: -999, type: "float" }],
    });
    expect(inferSimpleSchemaFromValue(JSON.stringify([true, false]))).toEqual({
      type: "primitive[]",
      fields: [inferSchemaField(true, "")],
    });
  });
  it("Returns generic schema when primitive array values are mixed", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify(["test", 123, false])),
    ).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Infers an object", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify({ a: "test", b: 123 })),
    ).toEqual({
      type: "object",
      fields: [inferSchemaField("test", "a"), inferSchemaField(123, "b")],
    });
  });
  it("Infers an array of objects", () => {
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify([
          { a: null, b: 123.5 },
          { a: "test2", b: 1000 },
          { b: -50, c: true },
        ]),
      ),
    ).toEqual({
      type: "object[]",
      fields: [
        { ...inferSchemaField(123.5, "b"), min: -999, max: 1000 },
        { ...inferSchemaField("test", "a"), required: false },
        { ...inferSchemaField(true, "c"), required: false },
      ],
    });
  });
  it("Returns generic schema when value has too much nesting", () => {
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify({ a: { b: { c: { d: { e: "test" } } } } }),
      ),
    ).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Returns generic array schema given an empty array (or one full of nulls)", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify([]))).toEqual({
      type: "object[]",
      fields: [],
    });
    expect(inferSimpleSchemaFromValue(JSON.stringify([null, null]))).toEqual({
      type: "object[]",
      fields: [],
    });
  });
});

// TODO: add test cases for simple schemas
describe("getValidation", () => {
  it("returns validationEnabled as true if jsonSchema is populated and enabled", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(true);
  });
  it("returns validationEnabled as false if jsonSchema enabled value is false", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: false,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled as false if jsonSchema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled if simple is set, even if schema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "simple",
      simple: {
        type: "primitive",
        fields: [
          {
            default: "",
            type: "string",
            description: "",
            enum: [],
            key: "",
            max: 256,
            min: 0,
            required: true,
          },
        ],
      },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(true);
  });
  it("returns validationEnabled false if simple schema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "simple",
      simple: { type: "object", fields: [] },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled as false if jsonSchema is undefined", () => {
    feature.jsonSchema = undefined;
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
});

describe("validateJSONFeatureValue", () => {
  it("returns valid as true if all values are valid and json schema test passes", () => {
    const value = { test: "123" };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(true);
  });
  it("returns valid as false if all values are valid but json schema test fails", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if json schema is invalid", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: '{ "type": 123 }',
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if unparseable json value is supplied", () => {
    const value = "{ not json }";
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as true if validation is not enabled", () => {
    const value = { test: "123" };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: false,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(true);
  });
});

describe("validateFeatureValue", () => {
  beforeAll(() => {
    feature.valueType = "boolean";
  });
  describe("boolean values", () => {
    it('returns "true" if value is truthy', () => {
      expect(validateFeatureValue(feature, "true", "testVal")).toEqual("true");
      expect(validateFeatureValue(feature, "0", "testVal")).toEqual("true");
    });
    it('returns "false" if value is "false"', () => {
      expect(validateFeatureValue(feature, "false", "testVal")).toEqual(
        "false",
      );
    });
  });

  describe("number values", () => {
    beforeAll(() => {
      feature.valueType = "number";
    });
    it("returns value if its a valid number", () => {
      let value = "0";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
      value = "9918";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
    });
    it("throws an error if value is not a valid number", () => {
      const value = "not-a-number";
      expect(() =>
        validateFeatureValue(feature, value, "testVal"),
      ).toThrowError();
    });
  });

  describe("json values", () => {
    beforeAll(() => {
      feature.valueType = "json";
    });

    it("returns unmodified string when already valid", () => {
      const value = '{ "test": 123 }';
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
    });

    it('parses json that is "slightly" invalid', () => {
      let value = "{ technically: 'not valid' }";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        '{"technically": "not valid"}',
      );
      value = "this is not jsonbruv";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        `"${value}"`,
      );
    });

    it("throws an error with invalid json", () => {
      const value = "{ not-an-object }";
      expect(() =>
        validateFeatureValue(feature, value, "testVal"),
      ).toThrowError();
    });
  });
});

describe("validateCondition", () => {
  it("returns success when condition is undefined", () => {
    expect(validateCondition(undefined)).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns success when condition is empty", () => {
    expect(validateCondition("")).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns success when condition is empty object", () => {
    expect(validateCondition("{}")).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns error when condition is completely invalid", () => {
    expect(validateCondition("{(+")).toEqual({
      success: false,
      empty: false,
      error: "Expected property name or '}' in JSON at position 1",
    });
  });
  it("returns error when condition is not an object", () => {
    expect(validateCondition("123")).toEqual({
      success: false,
      empty: false,
      error: "Must be object",
    });
  });
  it("returns suggested value when condition is invalid, but able to be fixed automatically", () => {
    expect(validateCondition("{test: true}")).toEqual({
      success: false,
      empty: false,
      error: "Expected property name or '}' in JSON at position 1",
      suggestedValue: '{"test":true}',
    });
  });
  it("returns success when condition is valid", () => {
    expect(validateCondition('{"test": true}')).toEqual({
      success: true,
      empty: false,
    });
  });
  it("returns error when condition has unknown nested saved group id", () => {
    expect(
      validateCondition(
        JSON.stringify({
          foo: "bar",
          $savedGroups: ["a"],
        }),
        new Map([
          [
            "known-group-id",
            {
              id: "known-group-id",
              type: "condition",
              condition: JSON.stringify({
                bar: "baz",
              }),
            },
          ],
        ]),
      ),
    ).toEqual({
      success: false,
      empty: false,
      error: "Condition includes invalid or cyclic saved group reference",
    });
  });
  it("returns success when condition has known nested saved group id", () => {
    expect(
      validateCondition(
        JSON.stringify({
          foo: "bar",
          $savedGroups: ["known-group-id"],
        }),
        new Map([
          [
            "known-group-id",
            {
              id: "known-group-id",
              type: "condition",
              condition: JSON.stringify({
                bar: "baz",
              }),
            },
          ],
        ]),
      ),
    ).toEqual({
      success: true,
      empty: false,
    });
  });
});

describe("check enviroments match", () => {
  it("should find a environment match", () => {
    const environments = ["prod", "staging"];
    const reviewSetting = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: ["prod"],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(true);
  });

  it("should not find a environment match", () => {
    const environments = ["prod-1"];
    const reviewSetting = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: ["prod"],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(false);
  });

  it("should turn on when everything is empty", () => {
    const environments = ["prod", "staging"];
    const reviewSetting: RequireReview = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(true);
  });
});
describe("check revision needs review", () => {
  it("should require review when env matches", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
  });
  it("should not require review", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });

  it("should require review with multi rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: ["a"],
        },
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: ["b"],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
  });
  it("should not require review with multi rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: [],
        },
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["staging"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });
  it("legacy rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: true,
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
    settings.requireReviews = false;
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });
});

describe("reset review on change", () => {
  it("require reset with single rule", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    const settingsOff: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
  });

  it("require reset with multiple rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: ["prod"],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    const settingsOff: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
  });
  it("turn off for first project", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: ["a"],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    feature.project = "a";
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["env"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    feature.project = "b";
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
  });
});
