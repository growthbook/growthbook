import { ConfigInterface } from "shared/types/config";
import { SimpleSchema } from "shared/types/feature";
import { assertConfigSchemaChangeSafeForDescendants } from "back-end/src/services/configReconcile";
import { Context } from "back-end/src/models/BaseModel";
import { SoftWarningError } from "back-end/src/util/errors";

const makeContext = ({
  configs,
  ignoreWarnings = false,
}: {
  configs: Partial<ConfigInterface>[];
  ignoreWarnings?: boolean;
}) =>
  ({
    ignoreWarnings,
    models: {
      configs: {
        getAllForReconcile: async () => configs as ConfigInterface[],
      },
    },
  }) as unknown as Context;

const intField = (key: string) => ({
  key,
  type: "integer" as const,
  required: false,
  default: "",
  description: "",
  enum: [],
});
const schemaOf = (...keys: string[]): SimpleSchema => ({
  type: "object",
  fields: keys.map(intField),
});

const base = {
  key: "base",
  name: "Base",
  schema: schemaOf("timeout", "retries"),
};
const child = {
  key: "child",
  name: "Prod API",
  parent: "base",
  value: '{"retries":5}',
};

describe("assertConfigSchemaChangeSafeForDescendants", () => {
  it("soft-warns when a removed field is still overridden, naming the descendant", async () => {
    const context = makeContext({ configs: [base, child] });
    const proposed = {
      ...base,
      schema: schemaOf("timeout"),
    } as ConfigInterface;

    const err = await assertConfigSchemaChangeSafeForDescendants(
      context,
      proposed,
    ).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(SoftWarningError);
    expect(err.message).toContain("1 descendant config(s)");
    expect(err.message).toContain(
      '"Prod API" (child): overrides removed field(s) "retries"',
    );
    expect(err.warnings).toHaveLength(1);
  });

  it("passes with ignoreWarnings (the ?ignoreWarnings=true bypass)", async () => {
    const context = makeContext({
      configs: [base, child],
      ignoreWarnings: true,
    });
    await expect(
      assertConfigSchemaChangeSafeForDescendants(context, {
        ...base,
        schema: schemaOf("timeout"),
      } as ConfigInterface),
    ).resolves.toBeUndefined();
  });

  it("passes when the change impacts no descendant", async () => {
    const context = makeContext({ configs: [base, child] });
    await expect(
      assertConfigSchemaChangeSafeForDescendants(context, {
        ...base,
        schema: schemaOf("timeout", "retries", "backoff"),
      } as ConfigInterface),
    ).resolves.toBeUndefined();
  });

  it("enumerates every kind of impact in the warning lines", async () => {
    const configs = [
      base,
      {
        key: "kid",
        name: "Kid",
        parent: "base",
        value: '{"retries":5,"timeout":7}',
        schema: {
          type: "object" as const,
          fields: [{ ...intField("backoff"), type: "string" as const }],
          invariants: [
            {
              name: "cap",
              rule: JSON.stringify({ retries: { $lte: 10 } }),
              message: "retries capped",
            },
          ],
        },
      },
    ];
    const context = makeContext({ configs });
    // Removes `retries` (orphans the override + breaks the rule), retypes
    // `timeout` integer→string (the kid's 7 stops conforming), and adds
    // `backoff` with a contract differing from the kid's declaration.
    const proposed = {
      ...base,
      schema: {
        type: "object" as const,
        fields: [
          { ...intField("timeout"), type: "string" as const },
          intField("backoff"),
        ],
      },
    } as ConfigInterface;

    const err = await assertConfigSchemaChangeSafeForDescendants(
      context,
      proposed,
    ).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(SoftWarningError);
    const line = err.warnings[0];
    expect(line).toContain('overrides removed field(s) "retries"');
    expect(line).toContain(
      'has value(s) that no longer match retyped field(s) "timeout"',
    );
    expect(line).toContain(
      'declares conflicting field(s) "backoff" that would be dropped',
    );
    expect(line).toContain(
      'validation rule "cap" references removed field(s) "retries"',
    );
  });
});
