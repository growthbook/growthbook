import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Flex, Box, Text, Heading } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { useRouter } from "next/router";
import Link from "@/ui/Link";
import DatePicker from "@/components/DatePicker";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SelectField from "@/components/Forms/SelectField";
import { useExperimentSearch } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import NorthStar from "@/components/HomePage/NorthStar";
import Frame from "@/ui/Frame";
import ExperimentList from "@/components/Experiment/ExperimentList";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Callout from "@/ui/Callout";
import ExecExperimentImpact from "@/enterprise/components/ExecReports/ExecExperimentImpact";
import { formatDateForURL, parseDateFromURL } from "@/utils/date";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import Field from "@/components/Forms/Field";
import ExperimentWinRate from "./ExperimentWinRate";
import ExecExperimentsGraph from "./ExecExperimentsGraph";
import { experimentDateRanges as dateRanges } from "./dateRanges";

export default function ExecReport() {
  const { project: currentProject, projects } = useDefinitions();
  const settings = useOrgSettings();
  const router = useRouter();
  const searchParams = new URLSearchParams(window.location.search);

  // Initialize state from query string
  const [dateRange, setDateRange] = useState(
    searchParams.get("dateRange") || "90",
  );
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - parseInt(dateRange));
  const [startDate, setStartDate] = useState<Date>(
    searchParams.get("startDate")
      ? parseDateFromURL(searchParams.get("startDate")!)
      : defaultStartDate,
  );
  const [endDate, setEndDate] = useState<Date>(
    searchParams.get("endDate")
      ? parseDateFromURL(searchParams.get("endDate")!)
      : new Date(),
  );
  // const [tag, setTag] = useState("");
  const [selectedMetric, setSelectedMetric] = useState(
    searchParams.get("selectedMetric") ||
      settings?.northStar?.metricIds?.[0] ||
      "",
  );
  const [experimentsToShow, setExperimentsToShow] = useState(
    searchParams.get("show") || "all",
  );

  const { hasCommercialFeature } = useUser();

  const {
    experiments: allExperiments,
    error,
    loading,
  } = useExperiments("", true, "standard");

  //const tagsFilter = useTagsFilter("experiments");

  // Shared filter for the search results: exclude multi-armed bandits. Status
  // and date-range constraints are applied separately on top of the search
  // results so the user's search filters affect both the Completed and
  // Running sections of the page.
  const filterResults = useCallback((items: ComputedExperimentInterface[]) => {
    return items.filter((item) => item.type !== "multi-armed-bandit");
  }, []);

  const {
    items: filteredExperiments,
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments,
    filterResults,
    localStorageKey: "exec-report-experiments",
  });

  // Completed Experiments section: further restrict to stopped + date range.
  const items = useMemo(() => {
    let filtered = filteredExperiments.filter((e) => e.status === "stopped");
    if (startDate && endDate) {
      filtered = filtered.filter((e) =>
        e.phases.some((p) => {
          if (!p.dateEnded) return false;
          const endDatePhase = new Date(p.dateEnded);
          return endDatePhase >= startDate && endDatePhase <= endDate;
        }),
      );
    } else if (endDate) {
      filtered = filtered.filter((e) =>
        e.phases.some((p) => {
          if (!p.dateEnded) return false;
          const endDatePhase = new Date(p.dateEnded);
          return endDatePhase <= endDate;
        }),
      );
    } else if (startDate) {
      filtered = filtered.filter((e) =>
        e.phases.some((p) => {
          if (!p.dateEnded) return false;
          const endDatePhase = new Date(p.dateEnded);
          return endDatePhase >= startDate;
        }),
      );
    }
    return filtered;
  }, [filteredExperiments, startDate, endDate]);

  // Derive selected project IDs from the syntax filters (project dropdown stores
  // project names as values; fall back to matching by id for typed filters).
  // When a global project is active, the project filter is hidden, so scope to it.
  const selectedProjects = useMemo<string[]>(() => {
    if (currentProject) return [currentProject];
    const projectFilter = syntaxFilters.find(
      (f) => f.field === "project" && !f.negated,
    );
    if (!projectFilter) return [];
    const ids: string[] = [];
    projectFilter.values.forEach((v) => {
      const match = projects.find((p) => p.id === v || p.name === v);
      if (match) ids.push(match.id);
    });
    return ids;
  }, [syntaxFilters, currentProject, projects]);

  // Running Experiments section: use the full search-filtered list so the
  // user's filters (project, owner, tag, metric, etc.) apply here too.
  // ExperimentList filters internally to status === "running".
  const allExpInProject = filteredExperiments;

  // Update URL query string when state changes
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    const params: Record<string, string> = {};
    let updateUrl = false;
    if (dateRange) {
      params.dateRange = dateRange;
    }
    if (startDate) {
      params.startDate = formatDateForURL(startDate);
    }
    if (endDate) {
      params.endDate = formatDateForURL(endDate);
    }
    if (selectedMetric) {
      params.selectedMetric = selectedMetric;
    }
    if (experimentsToShow) {
      params.show = experimentsToShow;
    }
    // loop through params and see if they are different from the current searchParams, and if we need to update the url:
    Object.keys(params).forEach((key) => {
      if (searchParams.get(key) !== params[key]) {
        searchParams.set(key, params[key]);
        updateUrl = true;
      }
    });
    // loop through existing searchParams and remove any that are not in params.
    // Preserve `q` since useExperimentSearch owns that param.
    searchParams.forEach((value, key) => {
      if (!params[key] && key !== "q") {
        searchParams.delete(key);
        updateUrl = true;
      }
    });
    if (updateUrl) {
      router
        .replace(
          router.pathname +
            (searchParams.size > 0 ? `?${searchParams.toString()}` : "") +
            window.location.hash,
          undefined,
          {
            shallow: true,
          },
        )
        .then();
    }
  }, [
    dateRange,
    startDate,
    endDate,
    selectedMetric,
    router,
    experimentsToShow,
    currentProject,
  ]);

  if (loading) {
    return <div>Loading...</div>;
  } else if (error) {
    return <div>There was a problem loading the data</div>;
  }

  return (
    <Box>
      <Flex justify="between" mb="4" gap="3">
        <Box>
          <Heading as="h1" size="5" mb="4">
            Completed Experiments
          </Heading>
          <Box>Use filters to adjust data displayed in this section.</Box>
        </Box>
        <Flex gap="5">
          <Box>
            <label>
              <Text
                weight="medium"
                size="2"
                style={{ color: "var(--color-text-high)" }}
                as="p"
                mb="1"
              >
                Filter by date range
              </Text>
              <SelectField
                options={dateRanges}
                sort={false}
                onChange={(e) => {
                  if (e !== "custom") {
                    const sDate = new Date();
                    sDate.setDate(sDate.getDate() - parseInt(e));
                    setStartDate(sDate);
                    setEndDate(new Date());
                  }
                  setDateRange(e);
                }}
                value={dateRange}
                style={{ width: "250px" }}
              />
            </label>
          </Box>
        </Flex>
      </Flex>
      {dateRange === "custom" && (
        <Flex
          my="2"
          justify="end"
          align="center"
          gap="3"
          style={{ position: "relative", top: "-7px" }}
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
      )}
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Flex align="center" gap="3">
          <Box flexBasis="300px" flexShrink="0">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          {(syntaxFilters.length > 0 || !!searchInputProps.value) && (
            <Link
              size="1"
              onClick={() => setSearchValue("")}
              style={{ whiteSpace: "nowrap" }}
            >
              Clear filters
            </Link>
          )}
        </Flex>
        <ExperimentSearchFilters
          searchInputProps={searchInputProps}
          syntaxFilters={syntaxFilters}
          setSearchValue={setSearchValue}
          experiments={allExperiments}
          showStatusFilter={false}
        />
      </Flex>
      {items.length > 0 ? (
        <>
          {hasCommercialFeature("experiment-impact") ? (
            <Box className="appbox" p="4" px="4" mb="4">
              <ExecExperimentImpact
                allExperiments={items}
                startDate={startDate}
                endDate={endDate}
                projects={selectedProjects}
                metric={selectedMetric}
                setMetric={setSelectedMetric}
                experimentsToShow={experimentsToShow}
                setExperimentsToShow={setExperimentsToShow}
              />
            </Box>
          ) : (
            <Box className="appbox" p="4" px="4" mb="4">
              <div className="pt-2">
                <div className="row align-items-start mb-4">
                  <div className="col-lg-auto">
                    <Heading size="3" className="mt-2">
                      Experiment Impact
                    </Heading>
                  </div>
                </div>
                <PremiumTooltip commercialFeature="experiment-impact">
                  Experiment Impact is available to Enterprise customers
                </PremiumTooltip>
              </div>
            </Box>
          )}
          <Flex gap="3" mb="3">
            <Box
              className="appbox"
              p="4"
              px="4"
              flexBasis={
                !selectedProjects?.length && projects.length ? "60%" : "50%"
              }
            >
              <ExperimentWinRate
                selectedProjects={selectedProjects ?? []}
                experiments={items}
                dateRange={dateRange}
                startDate={startDate}
                endDate={endDate}
                showProjectWinRate={
                  !selectedProjects?.length && projects.length > 0
                }
              />
            </Box>
            <Box
              className="appbox"
              p="4"
              px="4"
              flexBasis={
                !selectedProjects?.length && projects.length ? "40%" : "50%"
              }
            >
              <Box>
                <ExecExperimentsGraph
                  selectedProjects={selectedProjects}
                  experiments={items}
                  dateRange={dateRange}
                  startDate={startDate}
                  endDate={endDate}
                />
              </Box>
            </Box>
          </Flex>
        </>
      ) : (
        <Callout status="info" mb="4">
          No finished experiments found for the selected project and date range
        </Callout>
      )}

      {settings?.northStar?.metricIds?.length ? (
        <Box>
          <Flex justify="between">
            <Heading size="5">North Star Metrics</Heading>
          </Flex>
          <NorthStar
            experiments={items}
            showTitle={false}
            startDate={startDate}
            endDate={endDate}
          />
        </Box>
      ) : (
        <Frame>
          <Flex justify="between" align="center">
            <Heading size="5">North Star Metrics</Heading>
            <Link href="/settings#metrics" className="h6">
              Configure North Star Metrics
            </Link>
          </Flex>
          <Text mt="2">
            No North Star Metrics configured.{" "}
            <Link href="/settings#metrics">Add one now.</Link>
          </Text>
        </Frame>
      )}
      <Box mt="6" mb="6">
        <Flex justify="between">
          <Heading size="5">Running Experiments</Heading>
          <Link href={`/experiments`} className="float-right h6">
            View all
          </Link>
        </Flex>
        <Box className="appbox" p="4" px="4">
          <ExperimentList
            num={5}
            status={"running"}
            experiments={allExpInProject}
            localStorageKey="exec-report-running-experiments"
            as="table"
          />
        </Box>
      </Box>
    </Box>
  );
}
