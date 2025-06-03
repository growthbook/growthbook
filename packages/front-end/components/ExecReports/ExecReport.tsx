import React, { useState, useCallback, useEffect } from "react";
import { Flex, Box, Text, Heading } from "@radix-ui/themes";
import { getDisallowedProjects } from "shared/util";
import { ComputedExperimentInterface } from "back-end/types/experiment";
import { useRouter } from "next/router";
import Link from "next/link";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SelectField from "@/components/Forms/SelectField";
import { useExperimentSearch } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import NorthStar from "@/components/HomePage/NorthStar";
import ExperimentList from "@/components/Experiment/ExperimentList";
import Frame from "@/components/Radix/Frame";
import ExperimentGraph from "@/components/Experiment/ExperimentGraph";
import ActivityList from "@/components/ActivityList";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ExperimentWinRate from "./ExperimentWinRate";
import ExecExperimentImpact from "./ExecExperimentImpact";
import ExecExperimentsGraph from "./ExecExperimentsGraph";

const dateRanges = [
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "180 days", value: "180" },
  { label: "1 year", value: "365" },
  { label: "Custom", value: "custom" },
];

const formatDateForURL = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export default function ExecReport() {
  const { project: currentProject, projects } = useDefinitions();
  const settings = useOrgSettings();
  const router = useRouter();
  const searchParams = new URLSearchParams(window.location.search);

  // Initialize state from query string
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    searchParams.get("selectedProjects")?.split(",") || currentProject === ""
      ? []
      : [currentProject]
  );
  const [dateRange, setDateRange] = useState(
    searchParams.get("dateRange") || "90"
  );
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  const [startDate, setStartDate] = useState<Date>(
    searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : defaultStartDate
  );
  const [endDate, setEndDate] = useState<Date>(
    searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : new Date()
  );
  // const [tag, setTag] = useState("");
  const [selectedMetric, setSelectedMetric] = useState(
    searchParams.get("selectedMetric") ||
      settings?.northStar?.metricIds?.[0] ||
      ""
  );
  const [experimentsToShow, setExperimentsToShow] = useState(
    searchParams.get("show") || "won"
  );

  const { hasCommercialFeature } = useUser();
  //const permissionsUtil = usePermissionsUtil();

  const disallowedProjects = getDisallowedProjects(
    projects,
    selectedProjects ?? []
  );

  const projectsOptions = useProjectOptions(
    () => {
      return true;
    },
    selectedProjects || [],
    [...projects, ...disallowedProjects]
  );

  const { experiments: allExperiments, error, loading } = useExperiments(
    "",
    true,
    "standard"
  );

  //const tagsFilter = useTagsFilter("experiments");

  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      // filter by projects:
      if (selectedProjects && selectedProjects.length > 0) {
        items = items.filter((item) => {
          if (!item.project) return false;
          return selectedProjects.includes(item.project);
        });
      }
      // filter out any multi armed bandits:
      items = items.filter((item) => item.type !== "multi-armed-bandit");

      // filter out to only stopped experiments:
      items = items.filter((item) => item.status === "stopped");
      //items = filterByTags(items, tagsFilter.tags);

      // filter to dates:
      if (startDate && endDate) {
        items = items.filter((e) => {
          return e.phases.some((p) => {
            if (!p.dateEnded) return false;
            const endDatePhase = new Date(p.dateEnded);
            return endDatePhase >= startDate && endDatePhase <= endDate;
          });
        });
      } else if (endDate) {
        items = items.filter((e) => {
          return e.phases.some((p) => {
            if (!p.dateEnded) return false;
            const endDatePhase = new Date(p.dateEnded);
            return endDatePhase <= endDate;
          });
        });
      } else if (startDate) {
        items = items.filter((e) => {
          return e.phases.some((p) => {
            if (!p.dateEnded) return false;
            const endDatePhase = new Date(p.dateEnded);
            return endDatePhase >= startDate;
          });
        });
      }

      return items;
    },
    [endDate, selectedProjects, startDate]
  );

  const { items } = useExperimentSearch({
    allExperiments,
    filterResults,
  });

  // get a separate list of experiments, given the same filterResults function, but with the status of "running":
  const { items: allExpInProject } = useExperimentSearch({
    allExperiments,
    filterResults: useCallback(
      (items: ComputedExperimentInterface[]) => {
        return items.filter((item) => {
          // filter by projects:
          if (selectedProjects && selectedProjects.length > 0) {
            if (!item.project) return false;
            return selectedProjects.includes(item.project);
          }
          return true;
        });
      },
      [selectedProjects]
    ),
  });

  // Update URL query string when state changes
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    const params: Record<string, string> = {};
    let updateUrl = false;
    if (
      selectedProjects.length > 0 &&
      selectedProjects[0] !== "" &&
      selectedProjects[0] !== currentProject
    ) {
      params.selectedProjects = selectedProjects.join(",");
    }
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
    // loop through existing searchParams and remove any that are not in params:
    searchParams.forEach((value, key) => {
      if (!params[key]) {
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
          }
        )
        .then();
    }
  }, [
    selectedProjects,
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
      <Heading as="h1" size="5" mb="4">
        Program Overview
      </Heading>
      <Flex justify="between" mb="4" gap="3">
        <Box>
          <Box>Use filters to adjust data displayed in this section.</Box>
        </Box>
        <Flex gap="5">
          <Box style={{ width: "250px" }}>
            <label className="mb-1">
              <Text
                weight="medium"
                size="2"
                style={{ color: "var(--color-text-high)" }}
                as="p"
                mb="0"
              >
                Projects
              </Text>
            </label>
            <MultiSelectField
              placeholder="All Projects"
              value={selectedProjects ?? []}
              onChange={(ps) => setSelectedProjects(ps)}
              options={projectsOptions}
              containerClassName="mb-0 w-100"
              sort={false}
              closeMenuOnSelect={true}
            />
            {/*<TagsFilter filter={tagsFilter} items={filterResults} />*/}
          </Box>
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
      {hasCommercialFeature("experiment-impact") ? (
        <Box className="appbox" p="4" px="4">
          <ExecExperimentImpact
            filteredExperiments={items}
            allExperiments={allExperiments}
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
        <Box className="appbox" p="4" px="4">
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
      <Box>
        <Flex justify="between">
          <Heading size="4">North Star Metric</Heading>
        </Flex>
        <NorthStar
          experiments={items}
          showTitle={false}
          metrics={selectedMetric ? [selectedMetric] : []}
          startDate={startDate}
          endDate={endDate}
        />
      </Box>
      <Box mt="6" mb="4">
        <Flex justify="between">
          <Heading size="4">Running Experiments</Heading>
          <Link href={`/experiments`} className="float-right h6">
            View all
          </Link>
        </Flex>
        <Box className="appbox" p="4" px="4">
          <ExperimentList
            num={5}
            status={"running"}
            experiments={allExpInProject}
            as="table"
          />
        </Box>
      </Box>
      <Box>
        <div className="row">
          <div className="col-lg-12 col-md-12 col-xl-8">
            <Frame className="fixed-height" height="100%">
              <ExperimentGraph
                resolution={"month"}
                num={12}
                height={220}
                initialShowBy={"all"}
              />
            </Frame>
          </div>
          <div className="col-md-4">
            <Frame className="overflow-auto fixed-height" height="100%">
              <h4 className="">
                Recent Activity{" "}
                <Link href="/activity" className="float-right h6">
                  See all
                </Link>
              </h4>
              <ActivityList num={3} />
            </Frame>
          </div>
        </div>
      </Box>
    </Box>
  );
}
