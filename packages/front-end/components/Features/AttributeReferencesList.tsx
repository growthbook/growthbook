import { FC, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import ProjectBadges from "@/components/ProjectBadges";
import Pagination from "@/ui/Pagination";

const PER_PAGE = 20;

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
  const [featuresPage, setFeaturesPage] = useState(1);
  const [experimentsPage, setExperimentsPage] = useState(1);
  const [conditionGroupsPage, setConditionGroupsPage] = useState(1);

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
  const conditionGroupsStart = (conditionGroupsPage - 1) * PER_PAGE;
  const conditionGroupsPageItems = conditionGroups.slice(
    conditionGroupsStart,
    conditionGroupsStart + PER_PAGE,
  );

  return (
    <Box className="attr-references-list">
      <style>{`.attr-references-list .Collapsible { width: 100%; }`}</style>
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
              {featuresPageItems.map((feature) => (
                <li key={feature.id}>
                  <Flex justify="between" align="center" gap="2" my="1">
                    <Link href={`/features/${feature.id}`} target="_blank">
                      {(feature as { id: string; name?: string }).name ??
                        feature.id}
                    </Link>
                    <ProjectBadges
                      resourceType="feature"
                      projectIds={
                        (feature as { project?: string }).project
                          ? [(feature as { project: string }).project]
                          : undefined
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
                        (
                          experiment as {
                            project?: string;
                            projects?: string[];
                          }
                        ).project
                          ? [(experiment as { project?: string }).project!]
                          : (experiment as { projects?: string[] }).projects
                                ?.length
                            ? (experiment as { projects?: string[] }).projects
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
              {conditionGroupsPageItems.map((savedGroup) => (
                <li key={savedGroup.id}>
                  <Flex justify="between" align="center" gap="2" my="1">
                    <Link href="/saved-groups#conditionGroups" target="_blank">
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
            {conditionGroups.length > PER_PAGE && (
              <Pagination
                numItemsTotal={conditionGroups.length}
                perPage={PER_PAGE}
                currentPage={conditionGroupsPage}
                onPageChange={setConditionGroupsPage}
                className="mt-2"
              />
            )}
          </Collapsible>
        </Flex>
      )}
    </Box>
  );
};

export default AttributeReferencesList;
