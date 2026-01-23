import { FC } from "react";
import { FeatureInterface } from "shared/types/feature";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";

interface SavedGroupReferencesListProps {
  features?: Pick<FeatureInterface, "id">[];
  experiments?: Array<ExperimentInterface | ExperimentInterfaceStringDates>;
  savedGroups?: SavedGroupWithoutValues[];
}

const SavedGroupReferencesList: FC<SavedGroupReferencesListProps> = ({
  features = [],
  experiments = [],
  savedGroups = [],
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
                <Heading size="2" mb="0">
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
                    {feature.id}
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
                <Heading size="2" mb="0">
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
                    {experiment.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
      {savedGroups.length > 0 && (
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
                <Heading size="2" mb="0">
                  Saved Groups
                </Heading>
                <Badge radius="full" label={savedGroups.length.toString()} />
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
              {savedGroups.map((savedGroup) => (
                <li key={savedGroup.id}>
                  <Link href={`/saved-groups/${savedGroup.id}`} target="_blank">
                    {savedGroup.groupName}
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

export default SavedGroupReferencesList;
