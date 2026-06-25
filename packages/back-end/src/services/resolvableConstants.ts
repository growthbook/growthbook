import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// Configs live in their own collection but resolve identically to `json`
// constants (`@const:` + `$extends`) and freely cross-reference constants. So
// every resolution / cycle / reference site must consider BOTH collections.
// This surfaces a config as a `json` constant (its `schema` is irrelevant to
// resolution) — the single choke point that keeps the constant/config boundary
// invisible to the resolver.
//
// Lives in its own module (depending only on the context + types) so both the
// constants service and the features/payload pipeline can use it without an
// import cycle.
export function configAsConstant(config: ConfigInterface): ConstantInterface {
  return { ...config, type: "json" };
}

// The full set of resolvable values an `@const:` reference can target:
// constants + configs (coerced to `json`). Permission-filtered via each model's
// `getAll()`, matching the prior single-collection behavior. Use this anywhere
// a constant value-map, cycle graph, or reference graph is built.
export async function getResolvableConstants(
  context: ReqContext | ApiReqContext,
): Promise<ConstantInterface[]> {
  const [constants, configs] = await Promise.all([
    context.models.constants.getAll(),
    context.models.configs.getAll(),
  ]);
  return [...constants, ...configs.map(configAsConstant)];
}
