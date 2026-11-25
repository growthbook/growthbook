import React, { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { useLingui } from "@lingui/react/macro";
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
    includeTempRollouts?: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  experiments,
  setSearchValue,
  allowDrafts = true,
  showStatusFilter = true,
  includeTempRollouts = false,
}) => {
  const { t } = useLingui();
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
    healthItems,
  } = useExperimentFilterCategories({
    experiments,
    allowDrafts,
    includeTempRollouts,
  });

  return (
    <Flex gap="5" align="center" wrap="wrap">
      {!project && projects.length > 0 && (
        <FilterDropdown
          filter="project"
          heading={t`Project`}
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
        heading={t`Metric`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={metricItems}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="owner"
        heading={t`Owner`}
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
        heading={t`Result`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={resultItems}
        updateQuery={updateQuery}
      />
      {showStatusFilter && (
        <FilterDropdown
          filter="status"
          heading={t`Status`}
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={statusItems}
          updateQuery={updateQuery}
        />
      )}
      <FilterDropdown
        filter="tag"
        heading={t`Tag`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((tag) => {
          return {
            name: <Tag tag={tag} key={tag} skipMargin={true} variant="dot" />,
            id: tag,
            searchValue: tag,
          };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="has"
        heading={t`Type`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={typeItems}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="health"
        heading={t`Health`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={healthItems}
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
