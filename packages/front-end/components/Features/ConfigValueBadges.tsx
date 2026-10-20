import { useMemo } from "react";
import { getConfigAncestorKeys, selectScopedOverride } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

// Environments where the config, or a config it inherits from, serves one of
// its environment overrides.
export function useConfigOverrideEnvironments(
  configKey: string,
  project: string,
): string[] {
  const { configs } = useDefinitions();
  const environments = useEnvironments();
  return useMemo(() => {
    const byKey = new Map(configs.map((c) => [c.key, c]));
    const self = byKey.get(configKey);
    const lineage = self
      ? [configKey, ...getConfigAncestorKeys(self, byKey)]
      : [configKey];
    // Matches the resolver: archived and cross-project overrides don't apply.
    const applies = (key: string) => {
      const override = byKey.get(key);
      return (
        !!override &&
        !override.archived &&
        (!override.project || override.project === project)
      );
    };
    return environments
      .map((e) => e.id)
      .filter((environment) =>
        lineage.some((key) =>
          selectScopedOverride(
            byKey.get(key)?.scopedOverrides,
            { environment, project },
            applies,
          ),
        ),
      );
  }, [configs, environments, configKey, project]);
}

export function ConfigOverridesBadge({ fields }: { fields: string[] }) {
  if (!fields.length) return null;
  return (
    <Tooltip
      content={`This value overrides ${listFormat.format(fields)} from the Config in all environments.`}
    >
      <Badge
        size="xs"
        color="gray"
        label={`+${fields.length} ${fields.length === 1 ? "override" : "overrides"}`}
      />
    </Tooltip>
  );
}

// Without an environment, flags that the shown value isn't what every
// environment serves.
export function ConfigEnvironmentsBadge({
  configKey,
  project,
  environment = null,
}: {
  configKey: string;
  project: string;
  environment?: string | null;
}) {
  const overrideEnvironments = useConfigOverrideEnvironments(
    configKey,
    project,
  );
  if (environment !== null) {
    if (!overrideEnvironments.includes(environment)) return null;
    return (
      <Tooltip
        content={`The Config has an environment override for ${environment}.`}
      >
        <Badge size="xs" color="gray" label="Environment override" />
      </Tooltip>
    );
  }
  if (!overrideEnvironments.length) return null;
  return (
    <Tooltip
      content={`The Config has environment overrides for ${listFormat.format(overrideEnvironments)}. The values shown don't include them.`}
    >
      <Badge size="xs" color="gray" label="Varies by environment" />
    </Tooltip>
  );
}
