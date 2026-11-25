import { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import { getConfigAncestorKeys, selectScopedOverride } from "shared/util";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

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
  const { i18n } = useLingui();
  return (
    <>
      {new Intl.ListFormat(i18n.locale, { type: "conjunction" })
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
  const { t, i18n } = useLingui();
  if (!fields.length) return null;
  const fieldList = new Intl.ListFormat(i18n.locale, {
    type: "conjunction",
  }).format(fields);
  const count = fields.length;
  return (
    <Tooltip
      content={t`This value overrides ${fieldList} from the Config in all environments.`}
    >
      <Badge
        size="xs"
        color="gray"
        label={count === 1 ? t`+${count} override` : t`+${count} overrides`}
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
  const { t } = useLingui();
  const overrideEnvironments = useConfigOverrideEnvironments(
    configKey,
    project,
  );
  if (!overrideEnvironments.length) return null;
  const count = overrideEnvironments.length;
  return (
    <Tooltip
      content={
        <>
          <div>
            <Trans>
              The Config has environment overrides for{" "}
              <StrongList items={overrideEnvironments} />.
            </Trans>
          </div>
          <Box mt="2">
            {environment === null ? (
              <Trans>The values shown don&apos;t include them.</Trans>
            ) : overrideEnvironments.includes(environment) ? (
              <Trans>
                Showing the Config with <strong>{environment}</strong> overrides
                applied.
              </Trans>
            ) : (
              <Trans>
                <strong>{environment}</strong> has none, so the values shown are
                the Config&apos;s own.
              </Trans>
            )}
          </Box>
        </>
      }
    >
      <Badge
        size="xs"
        color="gray"
        label={
          count === 1
            ? t`${count} environment override`
            : t`${count} environment overrides`
        }
      />
    </Tooltip>
  );
}
