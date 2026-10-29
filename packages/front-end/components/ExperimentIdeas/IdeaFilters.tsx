import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import {
  ExperimentIdeaListItem,
  ExperimentIdeaSort,
  experimentIdeaSortValues,
} from "shared/validators";
import { ExperimentIdeaStage } from "shared/types/organization";
import { toggleVisibleStage } from "shared/experiment-ideas";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  FilterHeading,
  FilterItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { SyntaxFilter } from "@/services/search";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { SORT_LABELS } from "./constants";
import styles from "./ExperimentIdeas.module.scss";

const STAGE_TOKEN = /(^|\s)stage:(?:"[^"]*"|[^\s])*/g;

export function getVisibleStageIds(
  syntaxFilters: SyntaxFilter[],
  stages: ExperimentIdeaStage[],
): string[] {
  const filter = syntaxFilters.find((f) => f.field === "stage" && !f.negated);
  const ids = stages.map((s) => s.id);
  if (!filter) return ids;
  const selected = ids.filter((id) =>
    filter.values.some((v) => v.toLowerCase() === id.toLowerCase()),
  );
  return selected.length ? selected : ids;
}

function filterHeading(
  name: string,
  syntaxFilters: SyntaxFilter[],
  field: string,
  display: (value: string) => string = (v) => v,
): string {
  const values = syntaxFilters.find((f) => f.field === field)?.values ?? [];
  if (!values.length) return name;
  if (values.length === 1) return display(values[0]);
  return `${name} · ${values.length}`;
}

export default function IdeaFilters({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
  ideas,
  stages,
  sort,
  setSort,
}: BaseSearchFiltersProps & {
  ideas: ExperimentIdeaListItem[];
  stages: ExperimentIdeaStage[];
  sort: ExperimentIdeaSort;
  setSort: (sort: ExperimentIdeaSort) => void;
}) {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({ searchInputProps, syntaxFilters, setSearchValue });
  const { getOwnerDisplay } = useUser();

  const visibleStageIds = getVisibleStageIds(syntaxFilters, stages);

  const setVisibleStages = (ids: string[]) => {
    const rest = searchInputProps.value.replace(STAGE_TOKEN, "").trim();
    const token = ids.length === stages.length ? "" : `stage:${ids.join(",")}`;
    setSearchValue([rest, token].filter(Boolean).join(" "));
  };

  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ideas.forEach((i) => counts.set(i.stage, (counts.get(i.stage) ?? 0) + 1));
    return counts;
  }, [ideas]);

  const owners = useMemo(() => {
    const names = new Set<string>();
    ideas.forEach((i) => {
      if (i.owner) names.add(getOwnerDisplay(i.owner));
    });
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [ideas, getOwnerDisplay]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    ideas.forEach((i) =>
      i.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)),
    );
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [ideas]);

  const stageHeading =
    visibleStageIds.length === stages.length
      ? "Stage"
      : visibleStageIds.length === 1
        ? (stages.find((s) => s.id === visibleStageIds[0])?.label ?? "Stage")
        : `${visibleStageIds.length} stages`;

  const projectName = (id: string) =>
    projects.find((p) => p.id === id || p.name === id)?.name ?? id;

  return (
    <Flex gap="5" align="center" wrap="wrap" justify="end">
      <DropdownMenu
        trigger={FilterHeading({
          heading: stageHeading,
          open: dropdownFilterOpen === "stage",
        })}
        open={dropdownFilterOpen === "stage"}
        onOpenChange={(o) => setDropdownFilterOpen(o ? "stage" : "")}
        menuPlacement="end"
        variant="soft"
      >
        <DropdownMenuLabel>Show stages</DropdownMenuLabel>
        {stages.map((s) => {
          const checked = visibleStageIds.includes(s.id);
          const isLast = checked && visibleStageIds.length === 1;
          return (
            <DropdownMenuItem
              key={s.id}
              disabled={isLast}
              tooltip={
                isLast ? "At least one stage must be visible" : undefined
              }
              onClick={() =>
                setVisibleStages(toggleVisibleStage(visibleStageIds, s.id))
              }
            >
              <FilterItem
                exists={checked}
                item={
                  <Flex align="center" gap="2">
                    <span
                      className={styles.stageDot}
                      style={{ background: `var(--${s.color || "gray"}-9)` }}
                    />
                    {s.label}
                    <span style={{ color: "var(--color-text-low)" }}>
                      {stageCounts.get(s.id) ?? 0}
                    </span>
                  </Flex>
                }
              />
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={visibleStageIds.length === stages.length}
          onClick={() => setVisibleStages(stages.map((s) => s.id))}
        >
          Show all stages
        </DropdownMenuItem>
      </DropdownMenu>
      {!project && projects.length > 0 && (
        <FilterDropdown
          filter="project"
          heading={filterHeading(
            "Project",
            syntaxFilters,
            "project",
            projectName,
          )}
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={projects.map((p) => ({
            name: p.name,
            id: p.id,
            searchValue: p.id,
          }))}
          updateQuery={updateQuery}
          menuPlacement="end"
        />
      )}
      <FilterDropdown
        filter="owner"
        heading={filterHeading("Owner", syntaxFilters, "owner")}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <FilterDropdown
        filter="tag"
        heading={filterHeading("Tag", syntaxFilters, "tag")}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={tags.map(([t, c]) => ({
          name: `${t} (${c})`,
          id: t,
          searchValue: t,
        }))}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <DropdownMenu
        trigger={FilterHeading({
          heading: "Show archived",
          open: dropdownFilterOpen === "archived",
        })}
        open={dropdownFilterOpen === "archived"}
        onOpenChange={(o) => setDropdownFilterOpen(o ? "archived" : "")}
        menuPlacement="end"
        variant="soft"
      >
        <DropdownMenuItem
          onClick={() =>
            updateQuery({
              field: "is",
              values: ["archived"],
              operator: "",
              negated: false,
            })
          }
        >
          <FilterItem
            item="Include archived ideas"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu
        trigger={FilterHeading({
          heading: `Sort: ${SORT_LABELS[sort]}`,
          open: dropdownFilterOpen === "sort",
        })}
        open={dropdownFilterOpen === "sort"}
        onOpenChange={(o) => setDropdownFilterOpen(o ? "sort" : "")}
        menuPlacement="end"
        variant="soft"
      >
        {experimentIdeaSortValues.map((value) => (
          <DropdownMenuItem
            key={value}
            onClick={() => {
              setSort(value);
              setDropdownFilterOpen("");
            }}
          >
            <FilterItem item={SORT_LABELS[value]} exists={sort === value} />
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </Flex>
  );
}
