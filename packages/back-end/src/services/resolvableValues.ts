import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { getConfigParentKey, withParentExtends } from "shared/util";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// A constant or config flattened for reference resolution; `source` keeps the
// `@const:`/`@config:` namespaces from matching each other.
export type ResolvableValue = ConstantInterface & { source: ConstantSource };

// Shapes a config as a `json` constant. Synthesizes the `$extends` directive
// from `parent` (into the default + each env value) so resolution, cycle
// detection, and the reference graph see the lineage.
export function configToResolvable(config: ConfigInterface): ResolvableValue {
  const parentKey = getConfigParentKey(config);
  const environmentValues = config.environmentValues
    ? Object.fromEntries(
        Object.entries(config.environmentValues).map(([env, v]) => [
          env,
          withParentExtends(v, parentKey) ?? v,
        ]),
      )
    : config.environmentValues;
  return {
    ...config,
    type: "json",
    source: "config",
    value: withParentExtends(config.value, parentKey),
    environmentValues,
  };
}

// Every reference target: constants + configs, each tagged with its `source`.
export async function getResolvableValues(
  context: ReqContext | ApiReqContext,
): Promise<ResolvableValue[]> {
  const [constants, configs] = await Promise.all([
    context.models.constants.getAll(),
    context.models.configs.getAll(),
  ]);
  return [
    ...constants.map((c): ResolvableValue => ({ ...c, source: "constant" })),
    ...configs.map(configToResolvable),
  ];
}
