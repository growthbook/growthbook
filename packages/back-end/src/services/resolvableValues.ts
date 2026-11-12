import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import {
  getConfigBaseKeys,
  withConfigExtends,
  ScopedOverrideEntry,
} from "shared/util";
import { ConstantSource } from "shared/sdk-versioning";
import { getConstantReferenceKeys, RefSource } from "shared/validators";
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
//
// Memoized by doc identity: the models' memoized snapshots hand the same doc
// objects to every caller within a request, so the `$extends` synthesis (a
// parse + stringify of the full value) runs once per config. A write reloads
// the snapshot with fresh objects, invalidating naturally. Sharing the result
// is safe — resolvables are never mutated in place (writers like
// swapProposedResolvable copy).
const resolvableByDoc = new WeakMap<ConfigInterface, ResolvableValue>();
export function configToResolvable(config: ConfigInterface): ResolvableValue {
  const cached = resolvableByDoc.get(config);
  if (cached) return cached;
  const baseKeys = getConfigBaseKeys(config);
  const resolvable: ResolvableValue = {
    ...config,
    type: "json",
    source: "config",
    value: withConfigExtends(config.value, baseKeys),
  };
  resolvableByDoc.set(config, resolvable);
  return resolvable;
}

// What a client resolves one project's references with: the globals and
// that project's values (never another project's), each with its
// per-environment values and config flavors.
export type ClientResolvable = Pick<
  ResolvableValue,
  | "key"
  | "type"
  | "source"
  | "value"
  | "environmentValues"
  | "project"
  | "archived"
  | "scopedOverrides"
>;
// The keys a page's values name, by namespace.
export type ResolvableRoots = { constants: string[]; configs: string[] };

export async function getClientResolvables(
  context: ReqContext | ApiReqContext,
  project: string,
  // Only what these reach, so no other config is flattened or sent.
  roots?: ResolvableRoots,
): Promise<ClientResolvable[]> {
  const [allConstants, allConfigs] = await Promise.all([
    context.models.constants.getAll(),
    context.models.configs.getAll(),
  ]);
  const visible = <T extends { project?: string }>(c: T) =>
    !c.project || c.project === project;
  let constants = allConstants.filter(visible);
  let configs = allConfigs.filter(visible);
  if (roots) {
    const reached = reachableResolvables(constants, configs, roots);
    constants = constants.filter((c) => reached.constants.has(c.key));
    configs = configs.filter((c) => reached.configs.has(c.key));
  }
  return [
    ...constants.map((c): ResolvableValue => ({ ...c, source: "constant" })),
    ...configs.map(configToResolvable),
  ].map((c) => ({
    key: c.key,
    type: c.type,
    source: c.source,
    value: c.value,
    project: c.project,
    archived: c.archived,
    ...(c.environmentValues ? { environmentValues: c.environmentValues } : {}),
    ...(c.scopedOverrides?.length
      ? { scopedOverrides: c.scopedOverrides }
      : {}),
  }));
}

// The constants and configs resolving the roots can reach: what their values
// reference, a config's parent and mixins, and its flavors.
function reachableResolvables(
  constants: ConstantInterface[],
  configs: ConfigInterface[],
  roots: ResolvableRoots,
): { constants: Set<string>; configs: Set<string> } {
  const constantsByKey = new Map(constants.map((c) => [c.key, c]));
  const configsByKey = new Map(configs.map((c) => [c.key, c]));
  const reached = { constants: new Set<string>(), configs: new Set<string>() };
  const queue: [RefSource, string][] = [
    ...roots.constants.map((k): [RefSource, string] => ["constant", k]),
    ...roots.configs.map((k): [RefSource, string] => ["config", k]),
  ];
  const referencedBy = (
    value: string | undefined,
    environmentValues?: Record<string, string>,
  ) => {
    for (const source of ["constant", "config"] as const) {
      for (const key of getConstantReferenceKeys(
        value,
        environmentValues,
        source,
      )) {
        queue.push([source, key]);
      }
    }
  };
  for (let next = queue.pop(); next; next = queue.pop()) {
    const [source, key] = next;
    if (source === "constant") {
      const constant = constantsByKey.get(key);
      if (!constant || reached.constants.has(key)) continue;
      reached.constants.add(key);
      referencedBy(constant.value, constant.environmentValues);
    } else {
      const config = configsByKey.get(key);
      if (!config || reached.configs.has(key)) continue;
      reached.configs.add(key);
      referencedBy(config.value);
      for (const base of getConfigBaseKeys(config)) {
        queue.push(["config", base]);
      }
      for (const flavor of config.scopedOverrides ?? []) {
        queue.push(["config", flavor.config]);
      }
    }
  }
  return reached;
}

// Every reference target: constants + configs, each tagged with its `source`.
// The underlying loads are request-memoized by the models, so repeated calls
// within one request re-query nothing.
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
