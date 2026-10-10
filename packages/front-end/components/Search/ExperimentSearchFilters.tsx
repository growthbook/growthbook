import React, { FC, Fragment, ReactNode, useRef, useState } from "react";
import { PiPlusBold } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useExperimentFilterCategories } from "@/components/Search/experimentFilterCategories";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

const ExperimentSearchFilters: FC<
  BaseSearchFiltersProps & {
    experiments: ExperimentInterfaceStringDates[];
    allowDrafts?: boolean;
    showStatusFilter?: boolean;
    includeTempRollouts?: boolean;
    // Filters shown always (by key: "status", "health", ...); the rest wait
    // behind "Add Filter". Absent: every filter shows.
    defaultFilters?: string[];
  }
> = ({
  searchInputProps,
  syntaxFilters,
  experiments,
  setSearchValue,
  allowDrafts = true,
  showStatusFilter = true,
  includeTempRollouts = false,
  defaultFilters,
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
    healthItems,
  } = useExperimentFilterCategories({
    experiments,
    allowDrafts,
    includeTempRollouts,
  });

  // Every filter, in the bar's order. Project only without a project
  // selected; Status only where it applies.
  const filters: { key: string; heading: string; node: ReactNode }[] = [
    ...(!project && projects.length > 0
      ? [
          {
            key: "project",
            heading: "Project",
            node: (
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
            ),
          },
        ]
      : []),
    {
      key: "metric",
      heading: "Metric",
      node: (
        <FilterDropdown
          filter="metric"
          heading="Metric"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={metricItems}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "owner",
      heading: "Owner",
      node: (
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
      ),
    },
    {
      key: "is",
      heading: "Result",
      node: (
        <FilterDropdown
          filter="is"
          heading="Result"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={resultItems}
          updateQuery={updateQuery}
        />
      ),
    },
    ...(showStatusFilter
      ? [
          {
            key: "status",
            heading: "Status",
            node: (
              <FilterDropdown
                filter="status"
                heading="Status"
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                items={statusItems}
                updateQuery={updateQuery}
              />
            ),
          },
        ]
      : []),
    {
      key: "tag",
      heading: "Tag",
      node: (
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
      ),
    },
    {
      key: "has",
      heading: "Type",
      node: (
        <FilterDropdown
          filter="has"
          heading="Type"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={typeItems}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "health",
      heading: "Health",
      node: (
        <FilterDropdown
          filter="health"
          heading="Health"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={healthItems}
          updateQuery={updateQuery}
        />
      ),
    },
  ];

  // With defaultFilters (set in review; on the experiments list): those
  // always show, first, in the order given; the rest only once added from
  // "Add Filter", or while they're in use (e.g. from a shared link), so an
  // applied filter is never hidden. Without it, every filter shows, as
  // before.
  const [addedFilters, setAddedFilters] = useState<string[]>([]);
  const inUse = (key: string) => syntaxFilters.some((f) => f.field === key);
  const shown = defaultFilters
    ? [
        ...defaultFilters
          .map((key) => filters.find((f) => f.key === key))
          .filter((f): f is (typeof filters)[number] => !!f),
        ...filters.filter(
          (f) =>
            !defaultFilters.includes(f.key) &&
            (addedFilters.includes(f.key) || inUse(f.key)),
        ),
      ]
    : filters;
  const addable = defaultFilters
    ? filters.filter((f) => !shown.some((s) => s.key === f.key))
    : [];
  // Set when a filter is chosen from "Add Filter", so the menu closing
  // leaves focus for that filter's own dropdown, opened straight after.
  const openAfterAdd = useRef<string | null>(null);

  // With defaultFilters, "Add Filter" leads and the filters follow it to
  // the right (set in review), so the bar grows away from the search field;
  // without it, the filters show as before.
  return (
    <Flex gap="5" align="center">
      {addable.length > 0 ? (
        <DropdownMenu
          trigger={
            <Button
              variant="ghost"
              color="gray"
              icon={<PiPlusBold size={12} />}
            >
              Add Filter
            </Button>
          }
          menuPlacement="end"
          onCloseAutoFocus={(e) => {
            const key = openAfterAdd.current;
            if (!key) return;
            e.preventDefault();
            openAfterAdd.current = null;
            setDropdownFilterOpen(key);
          }}
        >
          {addable.map((f) => (
            <DropdownMenuItem
              key={f.key}
              onClick={() => {
                openAfterAdd.current = f.key;
                setAddedFilters((prev) => [...prev, f.key]);
              }}
            >
              {f.heading}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      ) : null}
      {shown.map((f) => (
        <Fragment key={f.key}>{f.node}</Fragment>
      ))}
    </Flex>
  );
};

export default ExperimentSearchFilters;
