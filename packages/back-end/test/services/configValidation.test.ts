import { ConfigInterface } from "shared/types/config";
import { FeatureRule } from "shared/types/feature";
import {
  assertConfigInvariantsValid,
  assertConfigBackedFeatureValuesValid,
  assertConfigBackedDefaultHasNoOverrides,
  assertConfigValueValidForCreate,
} from "back-end/src/services/configValidation";
import { Context } from "back-end/src/models/BaseModel";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";

const noDebug = {
  name: "no-debug",
  rule: JSON.stringify({ log_level: { $ne: "debug" } }),
  message: "Production configs cannot run at debug verbosity.",
};

const makeContext = ({
  configs,
  settings = {},
  ignoreWarnings = false,
  skipSchemaValidation = false,
}: {
  configs: Partial<ConfigInterface>[];
  settings?: Record<string, unknown>;
  ignoreWarnings?: boolean;
  skipSchemaValidation?: boolean;
}) =>
  ({
    org: { settings },
    ignoreWarnings,
    skipSchemaValidation,
    models: {
      configs: {
        getAllForReconcile: async () => configs as ConfigInterface[],
      },
    },
  }) as unknown as Context;

const base = {
  key: "base",
  name: "Base",
  value: '{"log_level":"info"}',
};
const child = {
  key: "child",
  name: "Prod API",
  parent: "base",
  schema: { type: "object" as const, fields: [], invariants: [noDebug] },
};

describe("assertConfigInvariantsValid (descendants)", () => {
  it("blocks a publish that newly violates a descendant's rule, naming it", async () => {
    const context = makeContext({ configs: [base, child] });
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"log_level":"debug"}',
      ),
    ).rejects.toThrow(
      new BadRequestError(
        'descendant "Prod API" (child): Production configs cannot run at debug verbosity.',
      ),
    );
  });

  it("does not block when the descendant violation pre-exists (introduced-only diff)", async () => {
    const liveBase = { ...base, value: '{"log_level":"debug"}' };
    const context = makeContext({ configs: [liveBase, child] });
    // Unrelated edit; the child's violation predates this publish.
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"log_level":"debug","other":2}',
      ),
    ).resolves.toBeUndefined();
  });

  it("reports a root violation once, without descendant echoes", async () => {
    // The rule lives on the base itself, so it fails identically at the base
    // and at the (non-overriding) child.
    const ruledBase = {
      ...base,
      schema: { type: "object" as const, fields: [], invariants: [noDebug] },
    };
    const plainChild = {
      key: "child",
      name: "Prod API",
      parent: "base",
    };
    const context = makeContext({ configs: [ruledBase, plainChild] });
    const err = await assertConfigInvariantsValid(
      context,
      { key: "base", name: "Base" },
      '{"log_level":"debug"}',
    ).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toBe(
      "Production configs cannot run at debug verbosity.",
    );
    expect(err.message).not.toMatch(/descendant/);
  });

  it("soft-warns instead of blocking when the org disables hard blocking", async () => {
    const context = makeContext({
      configs: [base, child],
      settings: { blockPublishOnSchemaError: false },
    });
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"log_level":"debug"}',
      ),
    ).rejects.toBeInstanceOf(SoftWarningError);
  });

  it("proceeds in soft-warn mode when warnings are ignored", async () => {
    const context = makeContext({
      configs: [base, child],
      settings: { blockPublishOnSchemaError: false },
      ignoreWarnings: true,
    });
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"log_level":"debug"}',
      ),
    ).resolves.toBeUndefined();
  });

  it("respects skipSchemaValidation", async () => {
    const context = makeContext({
      configs: [base, child],
      skipSchemaValidation: true,
    });
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"log_level":"debug"}',
      ),
    ).resolves.toBeUndefined();
  });
});

describe("assertConfigBackedDefaultHasNoOverrides", () => {
  const jsonBacked = { valueType: "json" as const, baseConfig: "base" };
  const run =
    (feature: typeof jsonBacked, defaultValue: string | undefined) => () =>
      assertConfigBackedDefaultHasNoOverrides(feature, defaultValue);

  it("allows a bare pure config default (empty patch on the base)", () => {
    expect(run(jsonBacked, "{}")).not.toThrow();
  });

  it("allows a descendant-config default with no patch", () => {
    expect(
      run(jsonBacked, JSON.stringify({ $extends: ["@config:child"] })),
    ).not.toThrow();
  });

  it("rejects inline overrides on the base config", () => {
    expect(run(jsonBacked, JSON.stringify({ retries: 5 }))).toThrow(
      BadRequestError,
    );
  });

  it("rejects inline overrides layered on a descendant config", () => {
    expect(
      run(
        jsonBacked,
        JSON.stringify({ $extends: ["@config:child"], retries: 5 }),
      ),
    ).toThrow(BadRequestError);
  });

  it("rejects a non-object (array) default that would drop the config entirely", () => {
    // The SDK serves a non-object default verbatim, ignoring the config — an
    // even more extreme override than an object patch, so it must be blocked.
    expect(run(jsonBacked, "[1, 2, 3]")).toThrow(BadRequestError);
  });

  it("rejects a non-object (scalar) default", () => {
    expect(run(jsonBacked, "42")).toThrow(BadRequestError);
    expect(run(jsonBacked, '"hardcoded"')).toThrow(BadRequestError);
  });

  it("ignores non-config-backed features (no baseConfig, no @config)", () => {
    expect(
      run(
        { valueType: "json", baseConfig: undefined } as typeof jsonBacked,
        JSON.stringify({ anything: 1 }),
      ),
    ).not.toThrow();
  });

  it("ignores non-JSON features", () => {
    expect(
      run(
        {
          valueType: "string",
          baseConfig: "base",
        } as unknown as typeof jsonBacked,
        "whatever",
      ),
    ).not.toThrow();
  });
});

describe("assertConfigBackedFeatureValuesValid", () => {
  const field = (
    key: string,
    type: "integer" | "string",
  ): Record<string, unknown> => ({
    key,
    type,
    required: false,
    default: "",
    description: "",
    enum: [],
  });
  const pricing = {
    key: "pricing",
    name: "Pricing",
    value: '{"context_window":8000,"log_level":"info"}',
    schema: {
      type: "object" as const,
      fields: [
        field("context_window", "integer"),
        field("log_level", "string"),
      ],
      invariants: [noDebug],
    },
  };
  const forceRule = (value: string): FeatureRule =>
    ({
      type: "force",
      id: "r",
      description: "",
      enabled: true,
      value,
      allEnvironments: true,
    }) as unknown as FeatureRule;

  it("blocks a rule patch whose field type violates the config schema", async () => {
    const context = makeContext({ configs: [pricing] });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: "pricing" },
        { rules: [forceRule('{"context_window":"banana"}')] },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("blocks a rule patch that violates a config invariant", async () => {
    const context = makeContext({ configs: [pricing] });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: "pricing" },
        { rules: [forceRule('{"log_level":"debug"}')] },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("passes a valid patch", async () => {
    const context = makeContext({ configs: [pricing] });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: "pricing" },
        {
          // Default is a pure config (no patch); the valid patch rides a rule.
          defaultValue: "{}",
          rules: [forceRule('{"context_window":16000,"log_level":"warn"}')],
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("is a no-op for a non-config flag", async () => {
    const context = makeContext({ configs: [pricing] });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: null },
        { defaultValue: '{"context_window":"banana"}' },
      ),
    ).resolves.toBeUndefined();
  });

  it("respects skipSchemaValidation", async () => {
    const context = makeContext({
      configs: [pricing],
      skipSchemaValidation: true,
    });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: "pricing" },
        { rules: [forceRule('{"context_window":"banana"}')] },
      ),
    ).resolves.toBeUndefined();
  });

  it("soft-warns instead of blocking when the org disables hard blocking", async () => {
    const context = makeContext({
      configs: [pricing],
      settings: { blockPublishOnSchemaError: false },
    });
    await expect(
      assertConfigBackedFeatureValuesValid(
        context,
        { valueType: "json", baseConfig: "pricing" },
        { rules: [forceRule('{"context_window":"banana"}')] },
      ),
    ).rejects.toBeInstanceOf(SoftWarningError);
  });
});

describe("assertConfigValueValidForCreate", () => {
  // A config whose schema declares a required `region` (no default).
  const leaf = {
    key: "cfg",
    name: "Cfg",
    schema: {
      type: "object" as const,
      fields: [
        {
          key: "region",
          type: "string" as const,
          required: true,
          default: "",
          description: "",
          enum: [],
        },
      ],
    },
  };

  it("rejects a value missing a required field", async () => {
    const context = makeContext({ configs: [] });
    await expect(
      assertConfigValueValidForCreate(context, leaf, { value: "{}" }),
    ).rejects.toThrow(/missing required field.*region/);
  });

  it("accepts a value that sets the required field", async () => {
    const context = makeContext({ configs: [] });
    await expect(
      assertConfigValueValidForCreate(context, leaf, {
        value: '{"region":"us"}',
      }),
    ).resolves.toBeUndefined();
  });

  it("exempts a value whose fields come from a @const $extends layer", async () => {
    const context = makeContext({ configs: [] });
    await expect(
      assertConfigValueValidForCreate(context, leaf, {
        value: '{"$extends":["@const:defaults"]}',
      }),
    ).resolves.toBeUndefined();
  });

  it("soft-warns instead of blocking when the org disables hard blocking", async () => {
    const context = makeContext({
      configs: [],
      settings: { blockPublishOnSchemaError: false },
    });
    await expect(
      assertConfigValueValidForCreate(context, leaf, { value: "{}" }),
    ).rejects.toBeInstanceOf(SoftWarningError);
  });

  it("proceeds in soft-warn mode when warnings are ignored", async () => {
    const context = makeContext({
      configs: [],
      settings: { blockPublishOnSchemaError: false },
      ignoreWarnings: true,
    });
    await expect(
      assertConfigValueValidForCreate(context, leaf, { value: "{}" }),
    ).resolves.toBeUndefined();
  });
});
