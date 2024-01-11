import { FeatureInterface } from "back-end/types/feature";
import {
  validateFeatureValue,
  getValidation,
  validateJSONFeatureValue,
  autoMerge,
  RulesAndValues,
  MergeConflict,
  validateCondition,
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

describe("getValidation", () => {
  it("returns validationEnabled as true if jsonSchema is populated and enabled", () => {
    feature.jsonSchema = {
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(true);
  });
  it("returns validationEnabled as false if jsonSchema enabled value is false", () => {
    feature.jsonSchema = {
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: false,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled as false if jsonSchema is invalid", () => {
    feature.jsonSchema = {
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
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(true);
  });
  it("returns valid as false if all values are valid but json schema test fails", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if json schema is invalid", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schema: '{ "type": 123 }',
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if unparseable json value is supplied", () => {
    const value = "{ not json }";
    feature.jsonSchema = {
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as true if validation is not enabled", () => {
    const value = { test: "123" };
    feature.jsonSchema = {
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

    it("parses json and returns in string format", () => {
      const value = '{ "test": 123 }';
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        '{"test": 123}'
      );
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
