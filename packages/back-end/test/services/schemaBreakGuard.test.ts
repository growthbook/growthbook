import { ConfigInterface } from "shared/types/config";
import { FeatureInterface } from "shared/types/feature";
import {
  collectConfigOwnBreaks,
  collectDependentConfigBreaks,
  collectDependentFeatureBreaks,
  unacknowledgedSchemaBreakViolations,
} from "back-end/src/services/schemaBreakGuard";
import { ResolvableValue } from "back-end/src/services/resolvableValues";

// Minimal fixtures — collectConfigOwnBreaks reads only the fields exercised
// below (buildConstantValueMap: key/type/value/environmentValues/project/
// source; collectResolvedConfigValueViolations: key/schema/parent/extends).
const constant = (
  key: string,
  value: string,
  environmentValues?: Record<string, string>,
): ResolvableValue =>
  ({
    key,
    type: "json",
    value,
    environmentValues,
    project: "",
    source: "constant",
  }) as unknown as ResolvableValue;

const portIntegerSchema = {
  type: "object" as const,
  fields: [
    {
      key: "port",
      type: "integer" as const,
      required: false,
      default: "",
      description: "",
      enum: [],
    },
  ],
};

// A config `c` with a `port: integer` schema. `liveValue` is what's published
// today; `resolvables` carries its live form + the constant it may reference.
function setup(liveValue: string, net: ResolvableValue) {
  const live = {
    key: "c",
    project: "",
    value: liveValue,
    schema: portIntegerSchema,
    extensible: false,
  } as unknown as ConfigInterface;
  const resolvables: ResolvableValue[] = [
    // Configs resolve as `type: "json"` (configToResolvable coerces this).
    { ...(live as unknown as ResolvableValue), type: "json", source: "config" },
    net,
  ];
  return { live, resolvables };
}

describe("collectConfigOwnBreaks", () => {
  it("flags a publish whose @const-backed field resolves to a bad type", () => {
    // Live: literal valid port. Proposed: pull port from a constant that
    // resolves to a string → introduced integer violation.
    const { resolvables } = setup(
      '{"port":3000}',
      constant("net", '{"port":"bad"}'),
    );
    const out = collectConfigOwnBreaks({
      resolvables,
      allConfigs: [
        {
          key: "c",
          project: "",
          value: '{"port":3000}',
          schema: portIntegerSchema,
          extensible: false,
        } as unknown as ConfigInterface,
      ],
      environments: ["prod"],
      extensibleDefault: false,
      proposed: {
        key: "c",
        project: "",
        value: '{"$extends":["@const:net"]}',
        schema: portIntegerSchema,
        extensible: false,
      },
    });
    expect(out.length).toBe(1);
    expect(out[0]).toContain("port");
    // Present in every environment → reported once, untagged.
    expect(out[0]).not.toContain("[prod]");
  });

  it("tags a break that only occurs in a specific environment", () => {
    // Constant is valid at base but bad in prod → the break is prod-only.
    const net = constant("net", '{"port":8080}', { prod: '{"port":"bad"}' });
    const { resolvables } = setup('{"port":3000}', net);
    const out = collectConfigOwnBreaks({
      resolvables,
      allConfigs: [
        {
          key: "c",
          project: "",
          value: '{"port":3000}',
          schema: portIntegerSchema,
          extensible: false,
        } as unknown as ConfigInterface,
      ],
      environments: ["prod", "staging"],
      extensibleDefault: false,
      proposed: {
        key: "c",
        project: "",
        value: '{"$extends":["@const:net"]}',
        schema: portIntegerSchema,
        extensible: false,
      },
    });
    expect(out).toEqual([expect.stringContaining("[prod]")]);
  });

  it("does not flag a pre-existing break the publish doesn't introduce", () => {
    // Both live and proposed reference the already-bad constant → the break
    // exists before and after, so it is NOT introduced by this publish.
    const net = constant("net", '{"port":"bad"}');
    const { resolvables } = setup('{"$extends":["@const:net"]}', net);
    const out = collectConfigOwnBreaks({
      resolvables,
      allConfigs: [
        {
          key: "c",
          project: "",
          value: '{"$extends":["@const:net"]}',
          schema: portIntegerSchema,
          extensible: false,
        } as unknown as ConfigInterface,
      ],
      environments: ["prod"],
      extensibleDefault: false,
      proposed: {
        key: "c",
        project: "",
        value: '{"$extends":["@const:net"]}',
        schema: portIntegerSchema,
        extensible: false,
      },
    });
    expect(out).toEqual([]);
  });

  it("returns nothing when there is no live config (a create)", () => {
    const out = collectConfigOwnBreaks({
      resolvables: [],
      allConfigs: [],
      environments: [],
      extensibleDefault: false,
      proposed: { key: "new", project: "", value: "{}" },
    });
    expect(out).toEqual([]);
  });
});

describe("collectDependentConfigBreaks", () => {
  // Config `c` pulls its port from constant `t`; schema requires integer.
  const configResolvable = {
    key: "c",
    type: "json",
    value: '{"$extends":["@const:t"]}',
    project: "",
    source: "config",
  } as unknown as ResolvableValue;
  const configNode = {
    key: "c",
    project: "",
    value: '{"$extends":["@const:t"]}',
    schema: portIntegerSchema,
    extensible: false,
  } as unknown as ConfigInterface;

  it("flags a base-value change that breaks a dependent config", () => {
    const out = collectDependentConfigBreaks({
      resolvables: [configResolvable, constant("t", '{"port":8080}')],
      allConfigs: [configNode],
      environments: ["prod"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":"bad"}',
    });
    expect(out).toEqual([expect.stringContaining('config "c"')]);
    expect(out[0]).not.toContain("[prod]");
  });

  it("flags a PER-ENVIRONMENT value change (env-tagged) — the F1 gap", () => {
    // t is valid at base and in prod today; the change sets prod to a bad type.
    const out = collectDependentConfigBreaks({
      resolvables: [
        configResolvable,
        constant("t", '{"port":8080}', { prod: '{"port":8080}' }),
      ],
      allConfigs: [configNode],
      environments: ["prod", "staging"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":8080}', // base unchanged
      proposedEnvironmentValues: { prod: '{"port":"bad"}' },
    });
    expect(out).toEqual([expect.stringContaining("[prod]")]);
  });

  it("does not flag when the per-env change stays schema-valid", () => {
    const out = collectDependentConfigBreaks({
      resolvables: [
        configResolvable,
        constant("t", '{"port":8080}', { prod: '{"port":8080}' }),
      ],
      allConfigs: [configNode],
      environments: ["prod"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":8080}',
      proposedEnvironmentValues: { prod: '{"port":9090}' },
    });
    expect(out).toEqual([]);
  });

  it("scopes a base-value break to the envs that inherit it — not all-env", () => {
    // The proposed BASE value breaks, but prod keeps a valid per-env override —
    // only staging (which inherits the base) actually serves the break. The
    // report must tag staging, not claim every environment.
    const out = collectDependentConfigBreaks({
      resolvables: [
        configResolvable,
        constant("t", '{"port":8080}', { prod: '{"port":9090}' }),
      ],
      allConfigs: [configNode],
      environments: ["prod", "staging"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":"bad"}',
      proposedEnvironmentValues: { prod: '{"port":9090}' },
    });
    expect(out).toEqual([expect.stringContaining("[staging]")]);
    expect(out[0]).toContain('config "c"');
  });

  it("drops a base-only break every live environment avoids via overrides", () => {
    // Every environment overrides the constant with a valid value, so the
    // broken base value serves nowhere — nothing to warn about.
    const out = collectDependentConfigBreaks({
      resolvables: [
        configResolvable,
        constant("t", '{"port":8080}', {
          prod: '{"port":9090}',
          staging: '{"port":9091}',
        }),
      ],
      allConfigs: [configNode],
      environments: ["prod", "staging"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":"bad"}',
      proposedEnvironmentValues: {
        prod: '{"port":9090}',
        staging: '{"port":9091}',
      },
    });
    expect(out).toEqual([]);
  });
});

describe("collectDependentFeatureBreaks", () => {
  it("keeps identical breaks in two same-type rules distinguishable (fingerprint identity)", () => {
    // Two force rules whose shipped values break the same way once the constant
    // changes. The violation strings double as the arm-time acknowledgment
    // fingerprint, so they must stay distinct per rule — collapsed entries would
    // let a NEW break in one rule masquerade as the acknowledged break of the
    // other at a deferred fire.
    const schema = {
      ...portIntegerSchema,
      fields: [
        ...portIntegerSchema.fields,
        {
          key: "label",
          type: "string" as const,
          required: false,
          default: "",
          description: "",
          enum: [],
        },
      ],
    };
    const configResolvable = {
      key: "c",
      type: "json",
      value: '{"$extends":["@const:t"]}',
      project: "",
      source: "config",
    } as unknown as ResolvableValue;
    const configNode = {
      key: "c",
      project: "",
      value: '{"$extends":["@const:t"]}',
      schema,
      extensible: false,
    } as unknown as ConfigInterface;
    const feature = {
      id: "f",
      project: "",
      valueType: "json",
      baseConfig: "c",
      defaultValue: '{"$extends":["@config:c"]}',
      rules: [
        {
          type: "force",
          id: "fr_1",
          value: '{"$extends":["@config:c"],"label":"a"}',
        },
        {
          type: "force",
          id: "fr_2",
          value: '{"$extends":["@config:c"],"label":"b"}',
        },
      ],
    } as unknown as FeatureInterface;

    const out = collectDependentFeatureBreaks({
      resolvables: [configResolvable, constant("t", '{"port":8080}')],
      features: [feature],
      allConfigs: [configNode],
      environments: [],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":"bad"}',
    });
    expect(out).toEqual([
      expect.stringContaining('feature "f" Rule fr_1 value'),
      expect.stringContaining('feature "f" Rule fr_2 value'),
    ]);
  });
});

describe("archive/unarchive transition breaks (proposedArchived)", () => {
  const requiredPortSchema = {
    type: "object" as const,
    fields: [
      {
        key: "port",
        type: "integer" as const,
        required: true,
        default: "",
        description: "",
        enum: [],
      },
    ],
  };
  const configResolvable = (key: string, value: string): ResolvableValue =>
    ({
      key,
      type: "json",
      value,
      project: "",
      source: "config",
    }) as unknown as ResolvableValue;

  it("flags archiving a config that supplies a dependent's required field", () => {
    // child inherits its required `port` from base; archiving base scrubs the
    // inherited layer, so child's resolved value loses the field.
    const resolvables = [
      configResolvable("base", '{"port":8080}'),
      configResolvable("child", '{"$extends":["@config:base"]}'),
    ];
    const allConfigs = [
      {
        key: "base",
        project: "",
        value: '{"port":8080}',
        schema: requiredPortSchema,
        extensible: false,
      },
      { key: "child", project: "", parent: "base", value: "{}" },
    ] as unknown as ConfigInterface[];
    const out = collectDependentConfigBreaks({
      resolvables,
      allConfigs,
      environments: ["prod"],
      extensibleDefault: false,
      source: "config",
      key: "base",
      proposedValue: undefined,
      proposedArchived: true,
    });
    expect(out).toEqual([expect.stringContaining('config "child"')]);
    expect(out[0]).toContain("port");
  });

  it("flags unarchiving a constant whose restored value violates a dependent's schema", () => {
    // While t was archived its refs were scrubbed (config resolves without a
    // port — fine, port isn't required here). Unarchiving restores the stored
    // string value into the integer field.
    const t = {
      ...constant("t", '{"port":"bad"}'),
      archived: true,
    } as ResolvableValue;
    const resolvables = [configResolvable("c", '{"$extends":["@const:t"]}'), t];
    const allConfigs = [
      {
        key: "c",
        project: "",
        value: '{"$extends":["@const:t"]}',
        schema: portIntegerSchema,
        extensible: false,
      },
    ] as unknown as ConfigInterface[];
    const out = collectDependentConfigBreaks({
      resolvables,
      allConfigs,
      environments: ["prod"],
      extensibleDefault: false,
      key: "t",
      proposedValue: '{"port":"bad"}', // unchanged — the transition is the flip
      proposedArchived: false,
    });
    expect(out).toEqual([expect.stringContaining('config "c"')]);
    expect(out[0]).toContain("port");
  });

  it("flags archiving a config that a feature ships directly (empty patch)", () => {
    // An empty-patch value resolves identically to the backing config, which is
    // normally covered by the dependent-config check — but the transitioning
    // config itself is excluded there, so the feature check must catch it.
    const feature = {
      id: "f",
      project: "",
      valueType: "json",
      baseConfig: "c",
      defaultValue: '{"$extends":["@config:c"]}',
      rules: [],
    } as unknown as FeatureInterface;
    const out = collectDependentFeatureBreaks({
      resolvables: [configResolvable("c", '{"port":8080}')],
      features: [feature],
      allConfigs: [
        {
          key: "c",
          project: "",
          value: '{"port":8080}',
          schema: requiredPortSchema,
          extensible: false,
        } as unknown as ConfigInterface,
      ],
      environments: [],
      extensibleDefault: false,
      source: "config",
      key: "c",
      proposedValue: undefined,
      proposedArchived: true,
    });
    expect(out).toEqual([expect.stringContaining('feature "f" Default value')]);
    expect(out[0]).toContain("port");
  });

  it("is silent when the archived entity has no dependents", () => {
    const resolvables = [
      configResolvable("lone", '{"port":8080}'),
      configResolvable("other", '{"port":1}'),
    ];
    const allConfigs = [
      {
        key: "lone",
        project: "",
        value: '{"port":8080}',
        schema: requiredPortSchema,
        extensible: false,
      },
      {
        key: "other",
        project: "",
        value: '{"port":1}',
        schema: requiredPortSchema,
        extensible: false,
      },
    ] as unknown as ConfigInterface[];
    const feature = {
      id: "f",
      project: "",
      valueType: "json",
      baseConfig: "other",
      defaultValue: '{"$extends":["@config:other"]}',
      rules: [],
    } as unknown as FeatureInterface;
    const shared = {
      resolvables,
      allConfigs,
      environments: ["prod"],
      extensibleDefault: false,
      source: "config" as const,
      key: "lone",
      proposedValue: undefined,
      proposedArchived: true,
    };
    expect(collectDependentConfigBreaks(shared)).toEqual([]);
    expect(
      collectDependentFeatureBreaks({ ...shared, features: [feature] }),
    ).toEqual([]);
  });
});

describe("unacknowledgedSchemaBreakViolations", () => {
  it("returns only breaks not acknowledged at arm time", () => {
    expect(
      unacknowledgedSchemaBreakViolations(["a", "b", "c"], ["a", "c"]),
    ).toEqual(["b"]);
  });

  it("treats all breaks as new when nothing was acknowledged", () => {
    expect(unacknowledgedSchemaBreakViolations(["a"], null)).toEqual(["a"]);
    expect(unacknowledgedSchemaBreakViolations(["a"], undefined)).toEqual([
      "a",
    ]);
  });

  it("is order-independent (membership, not sequence)", () => {
    expect(unacknowledgedSchemaBreakViolations(["b", "a"], ["a", "b"])).toEqual(
      [],
    );
  });
});
