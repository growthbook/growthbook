import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { useUser } from "@/services/UserContext";

const ExperimentSearchFilters: FC<
  BaseSearchFiltersProps & {
    experiments: ExperimentInterfaceStringDates[];
    allowDrafts?: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  experiments,
  setSearchValue,
  allowDrafts = true,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });
  const { getUserDisplay } = useUser();
  const allMetrics = useCombinedMetrics({});
  // const [createdOperator, setCreatedOperator] = useState("<");
  // const [createdDate, setCreatedDate] = useState<Date | undefined>();
  // const [updatedOperator, setUpdatedOperator] = useState(">");
  // const [updatedDate, setUpdatedDate] = useState<Date | undefined>();
  //
  // const dateOperatorsOptions = [
  //   { label: "Newer than", value: ">" },
  //   { label: "Older than", value: "<" },
  // ];

  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    experiments.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          if (!availableTags.includes(tag)) {
            availableTags.push(tag);
          }
        });
      }
    });
    return availableTags;
  }, [experiments]);

  const metricsMap = useMemo(() => {
    const map = new Map();
    allMetrics.forEach((m) => {
      map.set(m.id, {
        name: m.name,
        id: m.id,
        searchValue: m.name,
        disabled: true,
      });
    });

    experiments.forEach((e) => {
      const enableMetric = (m: string) => {
        if (m && map.has(m)) {
          map.set(m, {
            ...map.get(m),
            disabled: false,
          });
        }
      };

      e.goalMetrics?.forEach(enableMetric);
      e.secondaryMetrics?.forEach(enableMetric);
      e.guardrailMetrics?.forEach(enableMetric);
    });

    return map;
  }, [allMetrics, experiments]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    experiments.forEach((e) => {
      if (e.owner) {
        owners.add(getUserDisplay(e.owner) || e.owner);
      }
    });
    return Array.from(owners);
  }, [experiments, getUserDisplay]);

  const availableExperimentTypes = useMemo(() => {
    const experimentTypes = new Set<string>();
    experiments.forEach((e) => {
      if (e.linkedFeatures) {
        experimentTypes.add("feature");
      }
      if (e.hasURLRedirects) {
        experimentTypes.add("redirect");
      }
      if (e.hasVisualChangesets) {
        experimentTypes.add("visualChange");
      }
    });
    return Array.from(experimentTypes);
  }, [experiments]);
  const allExperimentTypes: SearchFiltersItem[] = [
    {
      name: "Feature Flag",
      id: "exp-type-flag",
      searchValue: "feature",
      disabled: !availableExperimentTypes.includes("feature"),
    },
    {
      name: "Visual Change",
      id: "exp-type-visual",
      searchValue: "visualChange",
      disabled: !availableExperimentTypes.includes("visualChange"),
    },
    {
      name: "URL Redirect",
      id: "exp-type-redirect",
      searchValue: "redirect",
      disabled: !availableExperimentTypes.includes("redirect"),
    },
  ];

  return (
    <Flex gap="5" align="center">
      {!project && (
        <FilterDropdown
          filter="project"
          heading="Project"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={projects.map((p) => {
            return { name: p.name, id: p.id, searchValue: p.name };
          })}
          updateQuery={updateQuery}
        />
      )}
      <FilterDropdown
        filter="metric"
        heading="Metric"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={Array.from(metricsMap.values())}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="owner"
        heading="Owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => {
          return { name: o, id: o, searchValue: o };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="is"
        heading="Result"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={[
          {
            searchValue: "won",
            id: "isWon",
            name: "Won",
          },
          {
            searchValue: "lost",
            id: "isLost",
            name: "Lost",
          },
          {
            searchValue: "inconclusive",
            id: "isInconclusive",
            name: "Inconclusive",
          },
          {
            searchValue: "dnf",
            id: "isDNF",
            name: "Did not finish",
          },
        ]}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="status"
        heading="Status"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={[
          {
            searchValue: "draft",
            id: "draft",
            name: "Draft",
            disabled: !allowDrafts,
          },
          {
            searchValue: "running",
            id: "running",
            name: "Running",
          },
          {
            searchValue: "stopped",
            id: "stopped",
            name: "Stopped",
          },
        ]}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="tag"
        heading="Tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => {
          return {
            name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
            id: t,
            searchValue: t,
          };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="has"
        heading="Type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={allExperimentTypes}
        updateQuery={updateQuery}
      />
      {/*<DropdownMenu*/}
      {/*  trigger={FilterHeading({*/}
      {/*    heading: "created",*/}
      {/*    open: dropdownFilterOpen === "created",*/}
      {/*  })}*/}
      {/*  open={dropdownFilterOpen === "created"}*/}
      {/*  onOpenChange={(o) => {*/}
      {/*    setDropdownFilterOpen(o ? "created" : "");*/}
      {/*  }}*/}
      {/*>*/}
      {/*  <Box px="2" py="1" mb="1">*/}
      {/*    <Heading as="h4" size="2" weight="bold" mb="0">*/}
      {/*      Filter by creation date*/}
      {/*    </Heading>*/}
      {/*  </Box>*/}
      {/*  <Box className="">*/}
      {/*    <Box pl="4">*/}
      {/*      From <DatePicker date={createdDate} setDate={setCreatedDate} />*/}
      {/*    </Box>*/}
      {/*  </Box>*/}
      {/*</DropdownMenu>*/}
    </Flex>
  );
};

export default ExperimentSearchFilters;
