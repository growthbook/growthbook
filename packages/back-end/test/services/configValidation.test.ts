import { ConfigInterface } from "shared/types/config";
import { assertConfigInvariantsValid } from "back-end/src/services/configValidation";
import { Context } from "back-end/src/models/BaseModel";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";

const noRealtime = {
  name: "no-realtime",
  rule: JSON.stringify({ stream_priority: { $ne: "realtime" } }),
  message: "This device tier cannot sustain realtime.",
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
  value: '{"stream_priority":"high"}',
};
const child = {
  key: "child",
  name: "Embedded Player",
  parent: "base",
  schema: { type: "object" as const, fields: [], invariants: [noRealtime] },
};

describe("assertConfigInvariantsValid (descendants)", () => {
  it("blocks a publish that newly violates a descendant's rule, naming it", async () => {
    const context = makeContext({ configs: [base, child] });
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"stream_priority":"realtime"}',
      ),
    ).rejects.toThrow(
      new BadRequestError(
        'descendant "Embedded Player" (child): This device tier cannot sustain realtime.',
      ),
    );
  });

  it("does not block when the descendant violation pre-exists (introduced-only diff)", async () => {
    const liveBase = { ...base, value: '{"stream_priority":"realtime"}' };
    const context = makeContext({ configs: [liveBase, child] });
    // Unrelated edit; the child's violation predates this publish.
    await expect(
      assertConfigInvariantsValid(
        context,
        { key: "base", name: "Base" },
        '{"stream_priority":"realtime","other":2}',
      ),
    ).resolves.toBeUndefined();
  });

  it("reports a root violation once, without descendant echoes", async () => {
    // The rule lives on the base itself, so it fails identically at the base
    // and at the (non-overriding) child.
    const ruledBase = {
      ...base,
      schema: { type: "object" as const, fields: [], invariants: [noRealtime] },
    };
    const plainChild = {
      key: "child",
      name: "Embedded Player",
      parent: "base",
    };
    const context = makeContext({ configs: [ruledBase, plainChild] });
    const err = await assertConfigInvariantsValid(
      context,
      { key: "base", name: "Base" },
      '{"stream_priority":"realtime"}',
    ).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toBe("This device tier cannot sustain realtime.");
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
        '{"stream_priority":"realtime"}',
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
        '{"stream_priority":"realtime"}',
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
        '{"stream_priority":"realtime"}',
      ),
    ).resolves.toBeUndefined();
  });
});
