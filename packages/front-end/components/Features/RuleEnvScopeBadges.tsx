import { Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { FaRegCircleCheck, FaRegCircleXmark } from "react-icons/fa6";
import { PiWarningCircle } from "react-icons/pi";
import { Environment } from "shared/types/organization";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

const MAX_VISIBLE_BADGES = 8;

// `activeEnvironmentIds`:
//   "all"    → violet badge per env in `environments`.
//   string[] → entries in `environments` render violet (active) or gray
//              (inactive). Entries NOT in `environments` are "disallowed"
//              and render as struck-through amber pills. Empty (or all-
//              disallowed) → amber "No environments" pill.
// `currentEnvironment` (when set) is promoted to position #2 so the active
// tab isn't lost to the `MAX_VISIBLE_BADGES` truncation.
type Props = {
  activeEnvironmentIds: string[] | "all";
  environments: Environment[];
  currentEnvironment?: string;
} & MarginProps;

function envBadge(envId: string, active: boolean) {
  const iconColor = active ? "var(--green-11)" : "var(--gray-8)";
  const textColor = active ? undefined : "var(--gray-8)";
  return (
    <Flex key={envId} align="center" gap="1">
      <span
        style={{
          color: textColor,
          fontSize: "var(--font-size-2)",
          fontWeight: active ? 500 : 300,
        }}
      >
        {envId}
      </span>
      {active ? (
        <FaRegCircleCheck size={14} style={{ color: iconColor }} />
      ) : (
        <FaRegCircleXmark size={14} style={{ color: iconColor }} />
      )}
    </Flex>
  );
}

function disallowedEnvBadge(envId: string) {
  return (
    <Tooltip
      key={`disallowed-${envId}`}
      body="This environment is not available for this feature. The rule will not apply here."
      tipPosition="top"
      innerClassName="p-2"
      style={{ display: "inline-flex", alignItems: "center" }}
    >
      <Flex align="center" gap="1">
        <span
          style={{
            color: "var(--amber-11)",
            fontSize: "var(--font-size-2)",
            textDecoration: "line-through",
          }}
        >
          {envId}
        </span>
        <PiWarningCircle size={16} style={{ color: "var(--amber-11)" }} />
      </Flex>
    </Tooltip>
  );
}

export default function RuleEnvScopeBadges({
  activeEnvironmentIds,
  environments,
  currentEnvironment,
  my = "3",
  ...marginProps
}: Props) {
  const knownEnvIds = new Set(environments.map((e) => e.id));
  const disallowedEnvIds =
    activeEnvironmentIds === "all"
      ? []
      : activeEnvironmentIds.filter((e) => !knownEnvIds.has(e));

  // No applicable footprint: empty list, or every entry is disallowed.
  const noActiveEnvs =
    Array.isArray(activeEnvironmentIds) &&
    activeEnvironmentIds.every((e) => !knownEnvIds.has(e));

  const activeSet =
    activeEnvironmentIds === "all"
      ? new Set(environments.map((e) => e.id))
      : new Set(activeEnvironmentIds);

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
    <Flex gap="4" wrap="wrap" align="center" my={my} {...marginProps}>
      {noActiveEnvs ? (
        <Tooltip
          body="Rule is not scoped to any environment and will not apply anywhere"
          tipPosition="top"
          innerClassName="p-2"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <Flex align="center" gap="1">
            <span
              style={{
                color: "var(--amber-11)",
                fontSize: "var(--font-size-2)",
              }}
            >
              No environments
            </span>
            <PiWarningCircle size={16} style={{ color: "var(--amber-11)" }} />
          </Flex>
        </Tooltip>
      ) : (
        visible.map((env) => envBadge(env.id, activeSet.has(env.id)))
      )}
      {disallowedEnvIds.map((envId) => disallowedEnvBadge(envId))}
      {!noActiveEnvs && overflow.length > 0 && (
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
              <Flex gap="4" wrap="wrap">
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
