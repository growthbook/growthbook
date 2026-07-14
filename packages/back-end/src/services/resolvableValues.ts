import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import {
  getConfigBaseKeys,
  withConfigExtends,
  ScopedOverrideEntry,
} from "shared/util";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// A constant or config flattened for reference resolution; `source` keeps the
// `@const:`/`@config:` namespaces from matching each other. `scopedOverrides`
// (configs only) carries the env/project variant selection through to the
// payload resolver.
export type ResolvableValue = ConstantInterface & {
  source: ConstantSource;
  scopedOverrides?: ScopedOverrideEntry[];
};

// Shapes a config as a `json` constant. Synthesizes the `$extends` directive
// from the config's base keys (`parent` + `extends` mixins, in precedence
// order) into the value, so resolution, cycle detection, and the reference graph
// see the full composition. Carries `scopedOverrides` so the resolver can apply
// the matching env/project flavor patch.
export function configToResolvable(config: ConfigInterface): ResolvableValue {
  const baseKeys = getConfigBaseKeys(config);
  return {
    ...config,
    type: "json",
    source: "config",
    value: withConfigExtends(config.value, baseKeys),
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
