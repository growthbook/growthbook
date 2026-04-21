import { Flex } from "@radix-ui/themes";
import { FeatureRule } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

const INACTIVE_COLLAPSE_THRESHOLD = 2;

/**
 * Read-only environment scope display for a rule card.
 *
 * - Shows a single "All Environments" pill when the rule covers every env.
 * - Otherwise: active envs always shown in full, inactive envs collapsed to
 *   "+ N more" after INACTIVE_COLLAPSE_THRESHOLD.
 * - Within each group, `currentEnvironment` is promoted to the front; the
 *   rest follow the tab order of `environments`.
 */
export default function RuleEnvScopeBadges({
  rule,
  environments,
  currentEnvironment,
}: {
  rule: Pick<FeatureRule, "allEnvironments" | "environments">;
  environments: Environment[];
  currentEnvironment?: string;
}) {
  const isAllEnvs =
    rule.allEnvironments === true || rule.environments === undefined;

  if (isAllEnvs) {
    return (
      <Flex gap="2" wrap="wrap" my="3">
        <Tooltip
          body="Rule is active in all environments"
          tipPosition="top"
          innerClassName="p-2"
        >
          <Badge
            label="All Environments"
            color="violet"
            variant="outline"
            radius="full"
            size="sm"
          />
        </Tooltip>
      </Flex>
    );
  }

  const activeSet = new Set(
    Array.isArray(rule.environments) ? rule.environments : [],
  );

  function sortedWithCurrentFirst(envs: Environment[]): Environment[] {
    if (!currentEnvironment) return envs;
    return [
      ...envs.filter((e) => e.id === currentEnvironment),
      ...envs.filter((e) => e.id !== currentEnvironment),
    ];
  }

  const active = sortedWithCurrentFirst(
    environments.filter((e) => activeSet.has(e.id)),
  );
  const inactive = sortedWithCurrentFirst(
    environments.filter((e) => !activeSet.has(e.id)),
  );

  const visibleInactive = inactive.slice(0, INACTIVE_COLLAPSE_THRESHOLD);
  const hiddenCount = inactive.length - visibleInactive.length;

  return (
    <Flex gap="2" wrap="wrap" my="3">
      {active.map((env) => (
        <Badge
          key={env.id}
          label={env.id}
          color="violet"
          variant="outline"
          radius="full"
          size="sm"
        />
      ))}
      {visibleInactive.map((env) => (
        <Badge
          key={env.id}
          label={env.id}
          color="gray"
          variant="outline"
          radius="full"
          size="sm"
          style={{ opacity: 0.3, backgroundColor: "var(--gray-a2)" }}
        />
      ))}
      {hiddenCount > 0 && (
        <Tooltip
          flipTheme={false}
          body={
            <>
              <Text
                as="div"
                weight="regular"
                mb="1"
                size="small"
                color="text-low"
              >
                Other inactive environments
              </Text>
              <Flex gap="1" wrap="wrap">
                {inactive.slice(INACTIVE_COLLAPSE_THRESHOLD).map((env) => (
                  <Badge
                    key={env.id}
                    label={env.id}
                    color="gray"
                    variant="outline"
                    radius="full"
                    size="sm"
                    style={{ opacity: 0.3, backgroundColor: "var(--gray-a2)" }}
                  />
                ))}
              </Flex>
            </>
          }
        >
          <Text as="span" color="text-low" size="small">
            ...
          </Text>
        </Tooltip>
      )}
    </Flex>
  );
}
