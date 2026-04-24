import { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import ProjectBadges from "@/components/ProjectBadges";
import Pagination from "@/ui/Pagination";

const PER_PAGE = 50;

type FeatureRef = { id: string; name?: string; project?: string };
type ExperimentRef = {
  id: string;
  name?: string;
  project?: string;
  projects?: string[];
};
type SavedGroupRef = { id: string; groupName?: string; projects?: string[] };

interface SavedGroupReferencesListProps {
  features?: FeatureRef[];
  experiments?: ExperimentRef[];
  savedGroups?: SavedGroupRef[];
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
    <Box className="saved-group-references-list">
      <style>{`.saved-group-references-list .Collapsible { width: 100%; }`}</style>
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
                listStyle: "none",
              }}
            >
              {featuresPageItems.map((feature) => (
                <li key={feature.id}>
                  <Flex justify="between" align="center" gap="2" my="1">
                    <Link href={`/features/${feature.id}`} target="_blank">
                      {feature.name ?? feature.id}
                    </Link>
                    <ProjectBadges
                      resourceType="feature"
                      projectIds={
                        feature.project ? [feature.project] : undefined
                      }
                      skipMargin
                    />
                  </Flex>
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
                listStyle: "none",
              }}
            >
              {experimentsPageItems.map((experiment) => (
                <li key={experiment.id}>
                  <Flex justify="between" align="center" gap="2" my="1">
                    <Link href={`/experiment/${experiment.id}`} target="_blank">
                      {experiment.name ?? experiment.id}
                    </Link>
                    <ProjectBadges
                      resourceType="experiment"
                      projectIds={
                        experiment.project
                          ? [experiment.project]
                          : experiment.projects?.length
                            ? experiment.projects
                            : undefined
                      }
                      skipMargin
                    />
                  </Flex>
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
                <Heading as="h3" size="small" mb="0">
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
                listStyle: "none",
              }}
            >
              {savedGroupsPageItems.map((savedGroup) => (
                <li key={savedGroup.id}>
                  <Flex justify="between" align="center" gap="2" my="1">
                    <Link
                      href={`/saved-groups/${savedGroup.id}`}
                      target="_blank"
                    >
                      {savedGroup.groupName ?? savedGroup.id}
                    </Link>
                    <ProjectBadges
                      resourceType="saved group"
                      projectIds={
                        savedGroup.projects?.length
                          ? savedGroup.projects
                          : undefined
                      }
                      skipMargin
                    />
                  </Flex>
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
