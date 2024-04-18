import {
  FeatureInterface,
  FeatureRule,
  SimpleSchema,
} from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  OrganizationSettings,
  RequireReview,
} from "back-end/types/organization";
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
      })
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
      })
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
      })
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
      })
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
      format: "grid",
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
      format: "table",
    });
  });
  it("converts primitive", () => {
    const primitiveSchema: SimpleSchema = {
      ...simpleSchema,
      type: "primitive",
    };
    expect(JSON.parse(simpleToJSONSchema(primitiveSchema))).toEqual(
      expectedProperties.a_string
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
      format: "table",
    });
  });

  it("throws an error if type is invalid", () => {
    const invalidSchema = { ...simpleSchema, type: "invalid" };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
    ).toThrowError("Value '0.25' not in enum for field invalid");
  });

  it("throws if fields are empty", () => {
    const invalidSchema = { ...simpleSchema, fields: [] };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
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
        format: "grid",
      }
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
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema))
    ).toThrowError("Value '0.5' is not an integer for field invalid");
  });

  it("Uses tab layout when there are more than 5 fields in object[] schema", () => {
    const arraySchema: SimpleSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "int1",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "",
          min: 0,
          max: 25,
        },
        {
          key: "int2",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "",
          min: 0,
          max: 25,
        },
      ],
      type: "object[]",
    };
    expect(JSON.parse(simpleToJSONSchema(arraySchema))).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          ...expectedProperties,
          int1: {
            type: "number",
            format: "number",
            minimum: 0,
            maximum: 25,
            multipleOf: 1,
          },
          int2: {
            type: "number",
            format: "number",
            minimum: 0,
            maximum: 25,
            multipleOf: 1,
          },
        },
        required: ["a_string", "a_float", "int1", "int2"],
        additionalProperties: false,
        format: "grid",
      },
      format: "tabs",
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
      enabled: false,
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
        "false"
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
        validateFeatureValue(feature, value, "testVal")
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
        '{"technically": "not valid"}'
      );
      value = "this is not jsonbruv";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        `"${value}"`
      );
    });

    it("throws an error with invalid json", () => {
      const value = "{ not-an-object }";
      expect(() =>
        validateFeatureValue(feature, value, "testVal")
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
      error: "Unexpected token ( in JSON at position 1",
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
      error: "Unexpected token t in JSON at position 1",
      suggestedValue: '{"test":true}',
    });
  });
  it("returns success when condition is valid", () => {
    expect(validateCondition('{"test": true}')).toEqual({
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
      })
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
      })
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
      })
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
      })
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
      })
    ).toEqual(true);
    settings.requireReviews = false;
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      })
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
      })
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      })
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      })
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      })
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
      })
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      })
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      })
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      })
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
      })
    ).toEqual(false);
    feature.project = "b";
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      })
    ).toEqual(true);
  });
});
