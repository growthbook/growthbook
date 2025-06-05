import React, { useCallback, useState, useEffect } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { getValidDate } from "shared/dates";
import { Box, Flex, Heading } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import { experimentDate } from "@/pages/experiments";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import CompletedExperimentList from "@/components/Experiment/CompletedExperimentList";
import ExperimentTimeline from "@/enterprise/components/Insights/ExperimentTimeline";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/components/Radix/LinkButton";

const LearningsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
    getSavedGroupById,
  } = useDefinitions();
  const searchParams = new URLSearchParams(window.location.search);
  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(
    searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000) // 180 days ago
  );
  const [endDate, setEndDate] = useState<Date>(
    searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days in the future
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("startDate", startDate.toISOString().slice(0, 10)); // Keep only YYYY-MM-DD
    params.set("endDate", endDate.toISOString().slice(0, 10)); // Keep only YYYY-MM-DD
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, "", newUrl);
  }, [startDate, endDate]);

  const { experiments: allExperiments, error, loading } = useExperiments(
    project,
    false,
    "standard"
  );
  const allStoppedExperiments = React.useMemo(
    () => allExperiments.filter((e) => e.status === "stopped"),
    [allExperiments]
  );

  const { getUserDisplay } = useUser();
  const getExperimentStatusIndicator = useExperimentStatusIndicator();

  const filterResults = useCallback(
    (items: typeof experiments) => {
      // only show experiments that are not archived and within the date range
      items = items.filter((item) => {
        if (item.archived) return false;
        const expDate = experimentDate(item);
        if (!expDate) return false;
        return (
          getValidDate(expDate) >= startDate && getValidDate(expDate) <= endDate
        );
      });
      return items;
    },
    [endDate, startDate]
  );

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

  const { items, searchInputProps, syntaxFilters, setSearchValue } = useSearch({
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
        if (item.results === "won") {
          is.push("winner");
          is.push("won");
        }
        if (item.results === "lost") {
          is.push("loser");
          is.push("lost");
        }
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.results === "dnf") is.push("dnf");
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

  const stoppedExperiments = React.useMemo(
    () => items.filter((e) => e.status === "stopped"),
    [items]
  );

  const SearchAndFilters = () => {
    return (
      <>
        <Flex align="center" gap="2" className="mb-3" justify="between">
          <Box flexBasis="60%" flexShrink="1" flexGrow="0">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          <Box>
            <Flex
              align="center"
              gap="4"
              justify="end"
              flexBasis="100%"
              style={{
                fontSize: "0.8rem",
              }}
            >
              <Flex align="center">
                <label className="mb-0 mr-2">From</label>
                <DatePicker
                  date={startDate}
                  setDate={(sd) => {
                    if (sd) {
                      setStartDate(sd);
                    }
                  }}
                  scheduleEndDate={endDate}
                  precision="date"
                  containerClassName=""
                />
              </Flex>
              <Flex align="center">
                <label className="mb-0 mr-2">To</label>
                <DatePicker
                  date={endDate}
                  setDate={(ed) => {
                    if (ed) setEndDate(ed);
                  }}
                  scheduleStartDate={startDate}
                  precision="date"
                  containerClassName=""
                />
              </Flex>
            </Flex>
          </Box>
        </Flex>
        <Box p="2">
          <ExperimentSearchFilters
            experiments={experiments}
            syntaxFilters={syntaxFilters}
            searchInputProps={searchInputProps}
            setSearchValue={setSearchValue}
            allowDrafts={false}
          />
        </Box>
      </>
    );
  };

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
          <Heading size="7" style={{ fontWeight: 500 }}>
            Experiment Learnings
          </Heading>

          <Tabs mt="3" defaultValue="experiments" persistInURL>
            <Box mb="5">
              <TabsList style={{ paddingTop: "5px" }}>
                <TabsTrigger value="experiments">
                  Completed Experiments
                </TabsTrigger>
                <TabsTrigger value="timeline">Experiment Timeline</TabsTrigger>
              </TabsList>
            </Box>

            <TabsContent value="experiments">
              {allStoppedExperiments.length === 0 ? (
                <EmptyState
                  title="Discover patterns in experiment outcomes"
                  description="Review past experiments to learn what's working and where to experiment next."
                  rightButton={null}
                  leftButton={
                    <LinkButton href="/experiments">
                      Create experiment
                    </LinkButton>
                  }
                />
              ) : (
                <CompletedExperimentList
                  searchAndFilters={<SearchAndFilters />}
                  experiments={stoppedExperiments}
                />
              )}
            </TabsContent>

            <TabsContent value="timeline">
              <ExperimentTimeline
                searchAndFilters={<SearchAndFilters />}
                experiments={items}
                startDate={startDate}
                endDate={endDate}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
};

export default LearningsPage;
