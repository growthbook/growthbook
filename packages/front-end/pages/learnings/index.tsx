import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiCaretDown, PiShuffle } from "react-icons/pi";
import {
  getAllMetricIdsFromExperiment,
  ExperimentMetricInterface,
  isFactMetricId,
  quantileMetricType,
} from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  ExperimentTemplateInterface,
} from "back-end/types/experiment";
import { Box, Flex, Heading, Switch, Text } from "@radix-ui/themes";
import { isEmpty } from "lodash";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useWatching } from "@/services/WatchProvider";
import { ExperimentStatusDetailsWithDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import LinkButton from "@/components/Radix/LinkButton";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import Button from "@/components/Radix/Button";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import { TemplatesPage } from "@/components/Experiment/Templates/TemplatesPage";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";
import EmptyState from "@/components/EmptyState";
import Callout from "@/components/Radix/Callout";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import ExperimentTemplatePromoCard from "@/enterprise/components/feature-promos/ExperimentTemplatePromoCard";
import { useTemplates } from "@/hooks/useTemplates";

const NUM_PER_PAGE = 20;

export function experimentDate(exp: ExperimentInterfaceStringDates): string {
  return (
    (exp.archived
      ? exp.dateUpdated
      : exp.status === "running"
      ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
      : exp.status === "stopped"
      ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
      : exp.dateCreated) ?? ""
  );
}

const LearningsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
    getSavedGroupById,
    getMetricById,
    getFactMetricById,
  } = useDefinitions();

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, false, "standard");

  const { getUserDisplay, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const getExperimentStatusIndicator = useExperimentStatusIndicator();

  const [currentPage, setCurrentPage] = useState(1);

  const filterResults = useCallback((items: typeof experiments) => {
    // only show experiments that are not archived and stopped.
    items = items.filter((item) => !item.archived && item.status === "stopped");
    return items;
  }, []);

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;
      const statusIndicator = getExperimentStatusIndicator(exp);
      const statusSortOrder = statusIndicator.sortOrder;
      const lastPhase = exp.phases?.[exp.phases?.length - 1] || {};
      const rawSavedGroup = lastPhase?.savedGroups || [];
      const savedGroupIds = rawSavedGroup.map((g) => g.ids).flat();

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.goalMetrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
        datasource: getDatasourceById(exp.datasource)?.name || "",
        savedGroups: savedGroupIds.map(
          (id) => getSavedGroupById(id)?.groupName
        ),
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
          ? "drafts"
          : exp.status,
        date: experimentDate(exp),
        statusIndicator,
        statusSortOrder,
      };
    },
    [getExperimentMetricById, getProjectById, getUserDisplay]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    updateSearchQueryOnChange: true,
    searchFields: [
      "name^3",
      "trackingKey^2",
      "id",
      "hypothesis^2",
      "description",
      "tags",
      "status",
      "ownerName",
      "metricNames",
      "results",
      "analysis",
    ],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.results === "won") is.push("winner");
        if (item.results === "lost") is.push("loser");
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.hasVisualChangesets) is.push("visual");
        if (item.hasURLRedirects) is.push("redirect");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasVisualChangesets) {
          has.push("visualChange", "visualChanges");
        }
        if (item.hasURLRedirects) has.push("redirect", "redirects");
        if (item.linkedFeatures?.length) has.push("features", "feature");
        if (item.hypothesis?.trim()?.length) has.push("hypothesis");
        if (item.description?.trim()?.length) has.push("description");
        if (item.variations.some((v) => !!v.screenshots?.length)) {
          has.push("screenshots");
        }
        if (
          item.status === "stopped" &&
          !item.excludeFromPayload &&
          (item.linkedFeatures?.length ||
            item.hasURLRedirects ||
            item.hasVisualChangesets)
        ) {
          has.push("rollout", "tempRollout");
        }
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      result: (item) =>
        item.status === "stopped" ? item.results || "unfinished" : "unfinished",
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      project: (item) => [item.project, item.projectName],
      feature: (item) => item.linkedFeatures || [],
      datasource: (item) => item.datasource,
      metric: (item) => [
        ...item.metricNames,
        ...getAllMetricIdsFromExperiment(item),
      ],
      savedgroup: (item) => item.savedGroups || [],
      goal: (item) => [...item.metricNames, ...item.goalMetrics],
    },
    filterResults,
  });

  const searchTermFilterExplainations = (
    <>
      <p>This search field supports advanced syntax search, including:</p>
      <ul>
        <li>
          <strong>name</strong>: The experiment name (eg: name:~homepage)
        </li>
        <li>
          <strong>id</strong>: The experiment id (eg: name:^exp)
        </li>
        <li>
          <strong>status</strong>: Experiment status, can be one of
          &apos;stopped&apos;, &apos;running&apos;, &apos;draft&apos;,
          &apos;archived&apos;
        </li>
        <li>
          <strong>datasource</strong>: Experiment datasource
        </li>
        <li>
          <strong>metric</strong>: Experiment uses the specified metric (eg:
          metric:~revenue)
        </li>
        <li>
          <strong>owner</strong>: The creator of the experiment (eg: owner:abby)
        </li>
        <li>
          <strong>tag</strong>: Experiments tagged with this tag
        </li>
        <li>
          <strong>project</strong>: The experiment&apos;s project
        </li>
        <li>
          <strong>feature</strong>: The experiment is linked to the specified
          feature
        </li>
        <li>
          <strong>created</strong>:The experiment&apos;s creation date, in UTC.
          Date entered is parsed so supports most formats.
        </li>
      </ul>
      <p>Click to see all syntax fields supported in our docs.</p>
    </>
  );

  // // Reset to page 1 when a filter is applied or tabs change
  // useEffect(() => {
  //   setCurrentPage(1);
  // }, [filtered.length]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = experiments.length > 0;

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  console.log("experiments: ", items);
  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="my-3">
          <div className="filters md-form row align-items-center">
            <div className="col-auto">
              <h1>Learnings</h1>
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <Tabs defaultValue="experiments" persistInURL>
            <Box mb="5">
              <TabsList>
                <TabsTrigger value="experiments">
                  Completed Experiments
                </TabsTrigger>
                <TabsTrigger value="templates">
                  Experiment Timeline{" "}
                  <PaidFeatureBadge commercialFeature="templates" mx="2" />
                </TabsTrigger>
              </TabsList>
            </Box>

            <TabsContent value="experiments">
              <CustomMarkdown page={"experimentList"} />
              {!hasExperiments ? (
                <EmptyState
                  title="Learning Library"
                  description="Learn from completed experiments"
                  leftButton={
                    <LinkButton
                      href="https://docs.growthbook.io/experiments"
                      variant="outline"
                      external
                    >
                      View docs
                    </LinkButton>
                  }
                  rightButton={<></>}
                />
              ) : (
                hasExperiments && (
                  <>
                    <div className="row align-items-center mb-3">
                      <div className="col-5">
                        <Field
                          placeholder="Search..."
                          type="search"
                          {...searchInputProps}
                        />
                      </div>
                      <div className="col-auto">
                        <Link
                          href="https://docs.growthbook.io/using/growthbook-best-practices#syntax-search"
                          target="_blank"
                        >
                          <Tooltip
                            body={searchTermFilterExplainations}
                          ></Tooltip>
                        </Link>
                      </div>
                    </div>

                    <Box>
                      {items.slice(start, end).map((e) => {
                        const goalMetrics = e.goalMetrics.map((m) => {
                          const metric = isFactMetricId(m)
                            ? getFactMetricById(m)
                            : getMetricById(m);
                          if (metric) {
                            return (
                              <Link
                                key={m}
                                href={`/metrics/${m}`}
                                className="text-decoration-none mr-3"
                              >
                                {metric.name}
                              </Link>
                            );
                          }
                          return null;
                        });
                        const moreGoalMetrics = e.goalMetrics.length > 2;

                        return (
                          <Box
                            key={e.trackingKey}
                            className="appbox"
                            mb="4"
                            p="3"
                          >
                            <Heading as="h2" size="2">
                              {e.name}
                            </Heading>
                            <Flex align="start" justify="start" gap="6">
                              <Box>
                                <Box>
                                  <Text
                                    weight="medium"
                                    size="1"
                                    color="gray"
                                    style={{ textTransform: "uppercase" }}
                                  >
                                    Duration
                                  </Text>
                                </Box>
                                <Box>
                                  {(e.phases?.[0]?.dateStarted
                                    ? date(e.phases?.[0]?.dateStarted)
                                    : "") +
                                    " - " +
                                    (e.date ? date(e.date) : "")}
                                </Box>
                              </Box>
                              <Box>
                                <Box>
                                  <Text
                                    weight="medium"
                                    color="gray"
                                    size="1"
                                    style={{ textTransform: "uppercase" }}
                                  >
                                    Owner
                                  </Text>
                                </Box>
                                <Box>
                                  {getUserDisplay(e.owner, false) || ""}
                                </Box>
                              </Box>
                              <Box>
                                <Box>
                                  <Text
                                    weight="medium"
                                    color="gray"
                                    size="1"
                                    style={{ textTransform: "uppercase" }}
                                  >
                                    Goal Metrics
                                  </Text>
                                </Box>
                                <Box>
                                  {goalMetrics.slice(0, 2)}{" "}
                                  {moreGoalMetrics
                                    ? `and ${goalMetrics.length - 2} more`
                                    : ""}
                                </Box>
                              </Box>
                              <Box>
                                <Box>
                                  <Text
                                    weight="medium"
                                    color="gray"
                                    size="1"
                                    style={{ textTransform: "uppercase" }}
                                  >
                                    Status
                                  </Text>
                                </Box>
                                <Box>{e.result} </Box>
                              </Box>
                            </Flex>
                          </Box>
                        );
                      })}
                    </Box>
                    {items.length > NUM_PER_PAGE && (
                      <Pagination
                        numItemsTotal={items.length}
                        currentPage={currentPage}
                        perPage={NUM_PER_PAGE}
                        onPageChange={setCurrentPage}
                      />
                    )}
                  </>
                )
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
};

export default LearningsPage;
