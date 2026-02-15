import { FC } from "react";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";

interface AttributeReferencesListProps {
  features?: FeatureInterface[];
  experiments?: ExperimentInterfaceStringDates[];
  conditionGroups?: SavedGroupWithoutValues[];
}

const AttributeReferencesList: FC<AttributeReferencesListProps> = ({
  features = [],
  experiments = [],
  conditionGroups = [],
}) => {
  return (
    <Box>
      {features.length > 0 && (
        <Flex
          gap="2"
          p="3"
          mb="4"
          align="start"
          className="bg-highlight rounded"
          direction="column"
        >
          <Collapsible
            trigger={
              <Flex align="center" gap="1">
                <PiCaretRightFill className="chevron" />
                <Heading as="h3" size="small" mb="0">
                  Features
                </Heading>
                <Badge radius="full" label={features.length.toString()} />
              </Flex>
            }
            open={true}
            transitionTime={100}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-4)",
                marginTop: "var(--space-2)",
              }}
            >
              {features.map((feature) => (
                <li key={feature.id}>
                  <Link href={`/features/${feature.id}`} target="_blank">
                    {(feature as { id: string; name?: string }).name ??
                      feature.id}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
      {experiments.length > 0 && (
        <Flex
          gap="2"
          p="3"
          mb="4"
          align="start"
          className="bg-highlight rounded"
          direction="column"
        >
          <Collapsible
            trigger={
              <Flex align="center" gap="1">
                <PiCaretRightFill className="chevron" />
                <Heading as="h3" size="small" mb="0">
                  Experiments
                </Heading>
                <Badge radius="full" label={experiments.length.toString()} />
              </Flex>
            }
            open={true}
            transitionTime={100}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-4)",
                marginTop: "var(--space-2)",
              }}
            >
              {experiments.map((experiment) => (
                <li key={experiment.id}>
                  <Link href={`/experiment/${experiment.id}`} target="_blank">
                    {experiment.name ?? experiment.id}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
      {conditionGroups.length > 0 && (
        <Flex
          gap="2"
          p="3"
          mb="4"
          align="start"
          className="bg-highlight rounded"
          direction="column"
        >
          <Collapsible
            trigger={
              <Flex align="center" gap="1">
                <PiCaretRightFill className="chevron" />
                <Heading as="h3" size="small" mb="0">
                  Condition Groups
                </Heading>
                <Badge
                  radius="full"
                  label={conditionGroups.length.toString()}
                />
              </Flex>
            }
            open={true}
            transitionTime={100}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-4)",
                marginTop: "var(--space-2)",
              }}
            >
              {conditionGroups.map((savedGroup) => (
                <li key={savedGroup.id}>
                  <Link href="/saved-groups#conditionGroups" target="_blank">
                    {savedGroup.groupName ?? savedGroup.id}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
    </Box>
  );
};

export default AttributeReferencesList;
