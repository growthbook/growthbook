import React, { useState, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { getDisallowedProjects } from "shared/util";
import { ComputedExperimentInterface } from "back-end/types/experiment";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { filterByTags, useTagsFilter } from "@/components/Tags/TagsFilter";
import { useExperiments } from "@/hooks/useExperiments";
import SelectField from "@/components/Forms/SelectField";
import { useExperimentSearch } from "@/services/experiments";
import ExperimentWinRate from "./ExperimentWinRate";

const dateRanges = [
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom", value: "custom" },
];

export default function ExecReport() {
  const { projects } = useDefinitions();
  const [selectedProjects, setSelectedProjects] = useState<string[]>();
  // const [tag, setTag] = useState("");
  const [dateRange, setDateRange] = useState("30");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

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

  const tagsFilter = useTagsFilter("experiments");

  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      if (dateRange !== "custom") {
        const date = new Date();
        date.setDate(date.getDate() - parseInt(dateRange));
        console.log("since: ", date.getTime());
        items = items.filter(
          (item) => new Date(item.date).getTime() > date.getTime()
        );
      } else {
        if (startDate && endDate) {
          items = items.filter(
            (item) =>
              new Date(item.date).getTime() >= startDate.getTime() &&
              new Date(item.date).getTime() <= endDate.getTime()
          );
        } else if (endDate) {
          items = items.filter(
            (item) => new Date(item.date).getTime() <= endDate.getTime()
          );
        } else if (startDate) {
          items = items.filter(
            (item) => new Date(item.date).getTime() >= startDate.getTime()
          );
        }
      }

      // filter out to only stopped experiments:
      items = items.filter((item) => item.status === "stopped");
      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [dateRange, endDate, startDate, tagsFilter.tags]
  );

  const { items } = useExperimentSearch({
    allExperiments,
    filterResults,
  });

  if (loading) {
    return <div>Loading...</div>;
  } else if (error) {
    return <div>There was a problem loading the data</div>;
  }
  console.log("filtered items: ", items);
  return (
    <Box>
      <Flex justify="between" mb="4">
        <Box>
          <MultiSelectField
            label="Projects"
            placeholder="All Projects"
            value={selectedProjects ?? []}
            onChange={(ps) => setSelectedProjects(ps)}
            options={projectsOptions}
            sort={false}
            closeMenuOnSelect={true}
          />
          {/*<TagsFilter filter={tagsFilter} items={filterResults} />*/}
        </Box>
        <Box>
          <SelectField
            label="Date Range"
            options={dateRanges}
            onChange={(e) => setDateRange(e)}
            value={dateRange}
          />
          {dateRange === "custom" && (
            <Flex mt="2">
              <label className="mb-0 mr-2">From</label>
              <DatePicker
                date={startDate}
                setDate={setStartDate}
                scheduleEndDate={endDate}
                precision="date"
                containerClassName=""
              />
              <label className="mb-0 mr-2">To</label>
              <DatePicker
                date={endDate}
                setDate={setEndDate}
                scheduleStartDate={startDate}
                precision="date"
                containerClassName=""
              />
            </Flex>
          )}
        </Box>
      </Flex>
      <ExperimentWinRate
        selectedProjects={selectedProjects}
        experiments={items}
        dateRange={dateRange}
        startDate={startDate}
        endDate={endDate}
      />
    </Box>
  );
}
