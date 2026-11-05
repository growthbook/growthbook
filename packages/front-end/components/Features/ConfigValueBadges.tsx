import { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import { getConfigAncestorKeys, selectScopedOverride } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

// Environments where the config, or a config it inherits from, serves one of
// its environment overrides.
function useConfigOverrideEnvironments(
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
      const config = byKey.get(key);
      return (
        !!config &&
        !config.archived &&
        (!config.project || config.project === project)
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

// "a, b, and c", with each item bolded.
function StrongList({ items }: { items: string[] }) {
  return (
    <>
      {listFormat
        .formatToParts(items)
        .map((part, i) =>
          part.type === "element" ? (
            <strong key={i}>{part.value}</strong>
          ) : (
            part.value
          ),
        )}
    </>
  );
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

// Counts the Config's environment overrides in every view; the tooltip says
// whether the values shown have the viewed environment's applied.
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
  if (!overrideEnvironments.length) return null;
  return (
    <Tooltip
      content={
        <>
          <div>
            The Config has environment overrides for{" "}
            <StrongList items={overrideEnvironments} />.
          </div>
          <Box mt="2">
            {environment === null ? (
              "The values shown don't include them."
            ) : overrideEnvironments.includes(environment) ? (
              <>
                Showing the Config with <strong>{environment}</strong> overrides
                applied.
              </>
            ) : (
              <>
                <strong>{environment}</strong> has none, so the values shown are
                the Config&apos;s own.
              </>
            )}
          </Box>
        </>
      }
    >
      <Badge
        size="xs"
        color="gray"
        label={`${overrideEnvironments.length} environment ${
          overrideEnvironments.length === 1 ? "override" : "overrides"
        }`}
      />
    </Tooltip>
  );
}
