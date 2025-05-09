import React, { useCallback } from "react";
import Link from "next/link";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Box } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import CompletedExperimentList from "@/components/Experiment/CompletedExperimentList";
import ExperimentTimeline from "@/components/Experiment/ExperimentTimeline";

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
  } = useDefinitions();

  const { experiments: allExperiments, error, loading } = useExperiments(
    project,
    false,
    "standard"
  );

  const { getUserDisplay } = useUser();
  const getExperimentStatusIndicator = useExperimentStatusIndicator();

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

  const { items, searchInputProps } = useSearch({
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
          <Box>
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
                  <Tooltip body={searchTermFilterExplainations}></Tooltip>
                </Link>
              </div>
            </div>
          </Box>
          <Tabs defaultValue="experiments" persistInURL>
            <Box mb="5">
              <TabsList>
                <TabsTrigger value="experiments">
                  Completed Experiments
                </TabsTrigger>
                <TabsTrigger value="timeline">
                  Experiment Timeline{" "}
                  <PaidFeatureBadge commercialFeature="templates" mx="2" />
                </TabsTrigger>
              </TabsList>
            </Box>

            <TabsContent value="experiments">
              <CompletedExperimentList experiments={items} />
            </TabsContent>
            <TabsContent value="timeline">
              <ExperimentTimeline experiments={items} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
};

export default LearningsPage;
