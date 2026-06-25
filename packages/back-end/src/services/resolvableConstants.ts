import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { getConfigParentKey, withParentExtends } from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// Configs resolve like `json` constants. Kept in its own module (types/context
// only) to avoid an import cycle with the features/payload pipeline.
//
// Inheritance lives on `parent`, not in the stored value — synthesize the
// `$extends` directive here (into the default + each env value) so resolution,
// cycle detection, and the reference graph all see the lineage.
export function configAsConstant(config: ConfigInterface): ConstantInterface {
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
    value: withParentExtends(config.value, parentKey),
    environmentValues,
  };
}

// Everything an `@const:` reference can target: constants + configs (as `json`).
export async function getResolvableConstants(
  context: ReqContext | ApiReqContext,
): Promise<ConstantInterface[]> {
  const [constants, configs] = await Promise.all([
    context.models.constants.getAll(),
    context.models.configs.getAll(),
  ]);
  return [...constants, ...configs.map(configAsConstant)];
}
