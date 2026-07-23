import { Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiWarningCircle } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

// Compact display of a project-scoped rule's projects (mirrors RuleEnvScopeBadges):
// out-of-delivery projects render struck-through, none-reachable shows an amber warning.
type Props = {
  projectIds: string[];
  // Feature delivery set (primary + targeting); null = all projects, nothing out of scope.
  deliveryProjectIds: string[] | null;
} & MarginProps;

export default function RuleProjectScopeBadges({
  projectIds,
  deliveryProjectIds,
  my = "3",
  ...marginProps
}: Props) {
  const { getProjectById } = useDefinitions();
  const name = (id: string) => getProjectById(id)?.name ?? id;

  const deliverySet =
    deliveryProjectIds === null ? null : new Set(deliveryProjectIds);
  const reachable =
    deliverySet === null
      ? projectIds
      : projectIds.filter((p) => deliverySet.has(p));
  const unavailable =
    deliverySet === null ? [] : projectIds.filter((p) => !deliverySet.has(p));

  // Applies nowhere: no projects, or all outside the delivery set.
  if (reachable.length === 0) {
    return (
      <Tooltip
        body="This rule is not scoped to any of the feature's Projects and will not apply anywhere"
        tipPosition="top"
        innerClassName="p-2"
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <Flex align="center" gap="1" my={my} {...marginProps}>
          <span
            style={{ color: "var(--amber-11)", fontSize: "var(--font-size-2)" }}
          >
            No Projects
          </span>
          <PiWarningCircle size={16} style={{ color: "var(--amber-11)" }} />
        </Flex>
      </Tooltip>
    );
  }

  return (
    <Text as="div" weight="regular" size="medium" my={my} {...marginProps}>
      <Text as="span" weight="medium">
        Projects:
      </Text>{" "}
      {reachable.map(name).join(", ")}
      {unavailable.length > 0 && (
        <Tooltip
          body="These Projects aren't available for this feature, so the rule won't apply there"
          tipPosition="top"
        >
          <span
            style={{
              color: "var(--amber-11)",
              textDecoration: "line-through",
              marginLeft: 6,
            }}
          >
            {unavailable.map(name).join(", ")}
          </span>
        </Tooltip>
      )}
    </Text>
  );
}
