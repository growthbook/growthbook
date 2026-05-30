import {
  DashboardBlockInterfaceOrData,
  MetricExperimentsBlockInterface,
  differenceTypes,
} from "shared/enterprise";
import React, { ChangeEvent, useMemo } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useExperiments } from "@/hooks/useExperiments";
import { transformQuery } from "@/services/search";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import MetricSelector from "@/components/Experiment/MetricSelector";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";

// Filter keys ExperimentSearchFilters emits into the raw search string. Kept in
// sync with the searchTermFilters used by useExperimentSearch so the parsed
// syntax filters light up the correct dropdowns.
const EXPERIMENT_FILTER_KEYS = [
  "project",
  "metric",
  "owner",
  "is",
  "status",
  "tag",
  "has",
];

const DIFFERENCE_TYPE_LABELS: Record<(typeof differenceTypes)[number], string> =
  {
    relative: "Relative",
    absolute: "Absolute",
    scaled: "Scaled Impact",
  };

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>
  >;
  projects: string[];
}

export default function MetricExperimentsSettings({
  block,
  setBlock,
  projects,
}: Props) {
  const { experiments } = useExperiments();

  const searchValue = block.experimentSearchString;
  const setSearchValue = (value: string) =>
    setBlock({ ...block, experimentSearchString: value });

  const searchInputProps = {
    value: searchValue,
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setSearchValue(e.target.value),
  };

  const syntaxFilters = useMemo(
    () => transformQuery(searchValue, EXPERIMENT_FILTER_KEYS).syntaxFilters,
    [searchValue],
  );

  return (
    <Flex direction="column" gap="5">
      <Box>
        <Box mb="2">
          <Text weight="bold">Metric</Text>
        </Box>
        <MetricSelector
          value={block.metricId}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
        />
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="bold">Filter Experiments</Text>
        </Box>
        <Flex gap="3" align="center" mb="2">
          <Box flexGrow="1">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          {(syntaxFilters.length > 0 || !!searchValue) && (
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
          experiments={experiments}
          wrap
        />
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="bold">Difference Type</Text>
        </Box>
        <SelectField
          value={block.differenceType}
          onChange={(value) =>
            setBlock({
              ...block,
              differenceType:
                value as MetricExperimentsBlockInterface["differenceType"],
            })
          }
          options={differenceTypes.map((dt) => ({
            label: DIFFERENCE_TYPE_LABELS[dt],
            value: dt,
          }))}
          sort={false}
        />
      </Box>
    </Flex>
  );
}
