import { Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

const INACTIVE_COLLAPSE_THRESHOLD = 2;

// `activeEnvironmentIds`:
//   "all"      → render a single "All Environments" pill (rule with allEnvironments / undefined)
//   string[]   → render explicit active envs (violet) and remaining envs (gray)
// Used by both feature rules (rule.environments / allEnvironments) and holdouts
// (derived from holdout.environmentSettings[envId].enabled).
type Props = {
  activeEnvironmentIds: string[] | "all";
  environments: Environment[];
  currentEnvironment?: string;
} & MarginProps;

export default function RuleEnvScopeBadges({
  activeEnvironmentIds,
  environments,
  currentEnvironment,
  my = "3",
  ...marginProps
}: Props) {
  if (activeEnvironmentIds === "all") {
    return (
      <Flex gap="2" wrap="wrap" my={my} {...marginProps}>
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

  const activeSet = new Set(activeEnvironmentIds);

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
    <Flex gap="2" wrap="wrap" my={my} {...marginProps}>
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
