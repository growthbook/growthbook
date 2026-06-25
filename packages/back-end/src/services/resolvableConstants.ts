import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { getConfigParentKey, withParentExtends } from "shared/util";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// A constant or config flattened into the shared resolution universe, tagged
// with its namespace `source` so references (`@const:`/`@config:`) only resolve
// against a matching entry.
export type ResolvableConstant = ConstantInterface & { source: ConstantSource };

// Configs resolve like `json` constants. Kept in its own module (types/context
// only) to avoid an import cycle with the features/payload pipeline.
//
// Inheritance lives on `parent`, not in the stored value — synthesize the
// `$extends` directive here (into the default + each env value) so resolution,
// cycle detection, and the reference graph all see the lineage.
export function configAsConstant(config: ConfigInterface): ResolvableConstant {
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

// Everything a reference can target: constants (`@const:`) + configs
// (`@config:`, coerced to `json`), each tagged with its namespace `source`.
export async function getResolvableConstants(
  context: ReqContext | ApiReqContext,
): Promise<ResolvableConstant[]> {
  const [constants, configs] = await Promise.all([
    context.models.constants.getAll(),
    context.models.configs.getAll(),
  ]);
  return [
    ...constants.map((c): ResolvableConstant => ({ ...c, source: "constant" })),
    ...configs.map(configAsConstant),
  ];
}
