import { FC, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Pagination from "@/ui/Pagination";

const PER_PAGE = 50;

interface SavedGroupReferencesListProps {
  features?: FeatureInterface[];
  experiments?: ExperimentInterfaceStringDates[];
  savedGroups?: SavedGroupWithoutValues[];
}

const SavedGroupReferencesList: FC<SavedGroupReferencesListProps> = ({
  features = [],
  experiments = [],
  savedGroups = [],
}) => {
  const [featuresPage, setFeaturesPage] = useState(1);
  const [experimentsPage, setExperimentsPage] = useState(1);
  const [savedGroupsPage, setSavedGroupsPage] = useState(1);

  const featuresStart = (featuresPage - 1) * PER_PAGE;
  const featuresPageItems = features.slice(
    featuresStart,
    featuresStart + PER_PAGE,
  );
  const experimentsStart = (experimentsPage - 1) * PER_PAGE;
  const experimentsPageItems = experiments.slice(
    experimentsStart,
    experimentsStart + PER_PAGE,
  );
  const savedGroupsStart = (savedGroupsPage - 1) * PER_PAGE;
  const savedGroupsPageItems = savedGroups.slice(
    savedGroupsStart,
    savedGroupsStart + PER_PAGE,
  );

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
              {featuresPageItems.map((feature) => (
                <li key={feature.id}>
                  <Link href={`/features/${feature.id}`} target="_blank">
                    {feature.id}
                  </Link>
                </li>
              ))}
            </ul>
            {features.length > PER_PAGE && (
              <Pagination
                numItemsTotal={features.length}
                perPage={PER_PAGE}
                currentPage={featuresPage}
                onPageChange={setFeaturesPage}
                className="mt-2"
              />
            )}
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
              {experimentsPageItems.map((experiment) => (
                <li key={experiment.id}>
                  <Link href={`/experiment/${experiment.id}`} target="_blank">
                    {experiment.name}
                  </Link>
                </li>
              ))}
            </ul>
            {experiments.length > PER_PAGE && (
              <Pagination
                numItemsTotal={experiments.length}
                perPage={PER_PAGE}
                currentPage={experimentsPage}
                onPageChange={setExperimentsPage}
                className="mt-2"
              />
            )}
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
              {savedGroupsPageItems.map((savedGroup) => (
                <li key={savedGroup.id}>
                  <Link href={`/saved-groups/${savedGroup.id}`} target="_blank">
                    {savedGroup.groupName}
                  </Link>
                </li>
              ))}
            </ul>
            {savedGroups.length > PER_PAGE && (
              <Pagination
                numItemsTotal={savedGroups.length}
                perPage={PER_PAGE}
                currentPage={savedGroupsPage}
                onPageChange={setSavedGroupsPage}
                className="mt-2"
              />
            )}
          </Collapsible>
        </Flex>
      )}
    </Box>
  );
};

export default SavedGroupReferencesList;
