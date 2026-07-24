import React, { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useExperimentFilterCategories } from "@/components/Search/experimentFilterCategories";

const ExperimentSearchFilters: FC<
  BaseSearchFiltersProps & {
    experiments: ExperimentInterfaceStringDates[];
    allowDrafts?: boolean;
    showStatusFilter?: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  experiments,
  setSearchValue,
  allowDrafts = true,
  showStatusFilter = true,
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

  // Shared source of truth for the filter taxonomy (see SidebarExperimentFilters).
  const {
    availableTags,
    metricItems,
    owners,
    resultItems,
    statusItems,
    typeItems,
  } = useExperimentFilterCategories({ experiments, allowDrafts });

  return (
    <Flex gap="5" align="center">
      {!project && projects.length > 0 && (
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
        items={metricItems}
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
        items={resultItems}
        updateQuery={updateQuery}
      />
      {showStatusFilter && (
        <FilterDropdown
          filter="status"
          heading="Status"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={statusItems}
          updateQuery={updateQuery}
        />
      )}
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
        items={typeItems}
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
