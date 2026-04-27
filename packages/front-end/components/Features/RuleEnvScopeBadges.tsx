import { Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

const MAX_VISIBLE_BADGES = 8;

// `activeEnvironmentIds`:
//   "all"      → rule applies to every applicable env (allEnvironments / undefined).
//                Expanded inline to violet badges for each env in `environments`.
//   string[]   → explicit env footprint. Envs in this list render violet,
//                envs absent render muted gray. Empty array → amber
//                "No environments" pill (rule does not apply anywhere).
//
// Order: natural order of `environments`, with `currentEnvironment` promoted
// to position #2 when set (i.e., the env tab the user is viewing surfaces
// near the front so it isn't lost to truncation). Truncates after
// `MAX_VISIBLE_BADGES`; the overflow is rendered (in order) inside a
// tooltip on the trailing "...".
//
// Used by feature rules (rule.environments / allEnvironments) and holdouts
// (derived from holdout.environmentSettings[envId].enabled).
type Props = {
  activeEnvironmentIds: string[] | "all";
  environments: Environment[];
  currentEnvironment?: string;
} & MarginProps;

function envBadge(envId: string, active: boolean) {
  return (
    <Badge
      key={envId}
      label={envId}
      color={active ? "violet" : "gray"}
      variant="outline"
      radius="full"
      size="sm"
      style={
        active ? undefined : { opacity: 0.3, backgroundColor: "var(--gray-a2)" }
      }
    />
  );
}

export default function RuleEnvScopeBadges({
  activeEnvironmentIds,
  environments,
  currentEnvironment,
  my = "3",
  ...marginProps
}: Props) {
  if (
    Array.isArray(activeEnvironmentIds) &&
    activeEnvironmentIds.length === 0
  ) {
    return (
      <Flex gap="2" wrap="wrap" my={my} {...marginProps}>
        <Tooltip
          body="Rule is not scoped to any environment and will not apply anywhere"
          tipPosition="top"
          innerClassName="p-2"
        >
          <Badge
            label="No environments"
            color="amber"
            variant="outline"
            radius="full"
            size="sm"
          />
        </Tooltip>
      </Flex>
    );
  }

  const activeSet =
    activeEnvironmentIds === "all"
      ? new Set(environments.map((e) => e.id))
      : new Set(activeEnvironmentIds);

  // Promote the current env tab to position #2 (index 1) when present and
  // not already in position #1 or #2.
  const ordered = [...environments];
  if (currentEnvironment) {
    const idx = ordered.findIndex((e) => e.id === currentEnvironment);
    if (idx > 1) {
      const [item] = ordered.splice(idx, 1);
      ordered.splice(1, 0, item);
    }
  }

  const visible = ordered.slice(0, MAX_VISIBLE_BADGES);
  const overflow = ordered.slice(MAX_VISIBLE_BADGES);

  return (
    <Flex gap="2" wrap="wrap" my={my} {...marginProps}>
      {visible.map((env) => envBadge(env.id, activeSet.has(env.id)))}
      {overflow.length > 0 && (
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
                {overflow.length} more environment
                {overflow.length === 1 ? "" : "s"}
              </Text>
              <Flex gap="1" wrap="wrap">
                {overflow.map((env) => envBadge(env.id, activeSet.has(env.id)))}
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
