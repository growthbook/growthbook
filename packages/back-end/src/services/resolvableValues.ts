import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { getConfigBaseKeys, withConfigExtends } from "shared/util";
import { ConstantSource } from "shared/sdk-versioning";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// A constant or config flattened for reference resolution; `source` keeps the
// `@const:`/`@config:` namespaces from matching each other.
export type ResolvableValue = ConstantInterface & { source: ConstantSource };

// Shapes a config as a `json` constant. Synthesizes the `$extends` directive
// from the config's base keys (`parent` + `extends` mixins, in precedence
// order) into the default + each env value, so resolution, cycle detection, and
// the reference graph see the full composition.
export function configToResolvable(config: ConfigInterface): ResolvableValue {
  const baseKeys = getConfigBaseKeys(config);
  const environmentValues = config.environmentValues
    ? Object.fromEntries(
        Object.entries(config.environmentValues).map(([env, v]) => [
          env,
          withConfigExtends(v, baseKeys),
        ]),
      )
    : config.environmentValues;
  return {
    ...config,
    type: "json",
    source: "config",
    value: withConfigExtends(config.value, baseKeys),
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
