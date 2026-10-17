import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { getImplementationType, isManagedByExperiment } from "shared/util";
import { Flex, type AvatarProps } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import Tooltip from "@/ui/Tooltip";
import Avatar from "@/ui/Avatar";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "./constants";

/** A shared experiment's implementation: how many of each kind it has. */
export default function LinkedChanges({
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  experiment,
}: {
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
}) {
  const hasManagedFlag = linkedFeatures.some((f) =>
    isManagedByExperiment(f.feature, experiment.id),
  );
  const effectiveType = hasManagedFlag
    ? "values"
    : getImplementationType(experiment);
  const valuesMode = effectiveType === "values";
  // Titled by kind; "Linked Changes" is reserved for legacy mixes.
  const boxTitle = valuesMode
    ? "Managed Feature Flag"
    : effectiveType === "multi"
      ? "Linked Changes"
      : effectiveType && effectiveType !== "none"
        ? IMPLEMENTATION_TYPE_OPTIONS[effectiveType].header
        : "Implementation";

  const publicLinkedChangeSummary: { id: LinkedChange; count: number }[] = [
    { id: "feature-flag", count: linkedFeatures.length },
    { id: "visual-editor", count: visualChangesets.length },
    { id: "redirects", count: urlRedirects.length },
  ];

  return (
    <Frame>
      <Flex align="center" gap="1" mb="4">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          {boxTitle}
        </Heading>
        {valuesMode && (
          <Tooltip
            content="This experiment owns this Feature Flag and serves its variation values through it."
            side="top"
          >
            <Flex align="center" style={{ color: "var(--color-text-low)" }}>
              <PiInfo />
            </Flex>
          </Tooltip>
        )}
      </Flex>

      <Flex direction="column" gap="3" mx="1" mb="2" mt="4">
        {publicLinkedChangeSummary
          .filter(({ count }) => count > 0)
          .map(({ id, count }) => {
            const { component: Icon, radixColor } = ICON_PROPERTIES[id];
            const label = LINKED_CHANGE_CONTAINER_PROPERTIES[id].header;
            return (
              <Flex key={id} gap="3" align="center">
                <Avatar
                  radius="full"
                  color={radixColor as AvatarProps["color"]}
                  size="lg"
                  variant="soft"
                >
                  <Icon />
                </Avatar>
                <Text size="lg" weight="medium" color="text-high">
                  {label}:
                </Text>
                <Text size="lg" weight="medium" color="text-mid">
                  {count}
                </Text>
              </Flex>
            );
          })}
      </Flex>
    </Frame>
  );
}
