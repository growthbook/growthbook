import { FC, useCallback, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiSparkleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { LearningWithCanManage } from "shared/validators";
import { date, getValidDate } from "shared/dates";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import EmptyState from "@/components/EmptyState";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ConfirmModal from "@/components/ConfirmModal";
import CollapsibleDiscussion from "@/components/CollapsibleDiscussion";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import {
  FilterDropdown,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useSearch } from "@/services/search";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
import EditLearningModal from "./EditLearningModal";
import RefreshLearningsModal from "./RefreshLearningsModal";
import ExperimentChips from "./ExperimentChips";

const SavedLearningsList: FC<{
  learnings: LearningWithCanManage[];
  experiments: ExperimentInterfaceStringDates[];
  mutate: () => void;
}> = ({ learnings, experiments, mutate }) => {
  const { apiCall } = useAuth();
  const { getOwnerDisplay } = useUser();
  const { projects: orgProjects, getProjectById } = useDefinitions();
  const orgSettings = useOrgSettings();
  const { aiEnabled } = useAISettings();
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
  const statusMap = useMemo(
    () => new Map(learningStatuses.map((s) => [s.id, s])),
    [learningStatuses],
  );
  const [pendingDelete, setPendingDelete] =
    useState<LearningWithCanManage | null>(null);
  const [pendingEdit, setPendingEdit] = useState<LearningWithCanManage | null>(
    null,
  );
  const [pendingRefresh, setPendingRefresh] =
    useState<LearningWithCanManage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Date range isn't expressible as a search token, so it stays local state
  // and is applied through useSearch's filterResults (same as the Experiment
  // Library tab).
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  const filterResults = useCallback(
    (items: LearningWithCanManage[]) => {
      if (!startDate && !endDate) return items;
      return items.filter((i) => {
        const created = getValidDate(i.dateCreated);
        if (startDate && created < startDate) return false;
        if (endDate && created > endDate) return false;
        return true;
      });
    },
    [startDate, endDate],
  );

  // Search + filter tokens live in one query string, so selecting a filter
  // writes `tag:foo` into the search box and hand-typed tokens work too —
  // matching every other filtered list in the app.
  const {
    items: filteredLearnings,
    searchInputProps,
    syntaxFilters,
    setSearchValue,
    clear: clearSearch,
    isFiltered,
  } = useSearch({
    items: learnings,
    localStorageKey: "learnings",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["title^3", "text", "tags"],
    filterResults,
    searchTermFilters: {
      tag: (i) => i.tags || [],
      // "" is the no-status bucket, so it stays filterable as `status:""`
      status: (i) => i.status || "",
      project: (i) => i.projects || [],
      source: (i) => i.source,
    },
  });

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  const experimentMap = new Map(experiments.map((e) => [e.id, e]));

  // Batch-fetch comment counts for all learnings in one request so each card
  // doesn't fire its own discussion fetch just to render a count.
  const learningIdsKey = useMemo(
    () =>
      learnings
        .map((i) => i.id)
        .sort()
        .join(","),
    [learnings],
  );
  const { data: commentCountsData } = useApi<{
    counts: Record<string, number>;
  }>(`/discussions/counts/learning?ids=${learningIdsKey}`, {
    shouldRun: () => learningIdsKey.length > 0,
  });

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    learnings.forEach((i) => {
      (i.tags || []).forEach((t) => {
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [learnings]);

  const tagFilterItems: SearchFiltersItem[] = useMemo(
    () =>
      allTags.map(([t, c]) => ({
        id: `tag-${t}`,
        name: `${t} (${c})`,
        searchValue: t,
      })),
    [allTags],
  );

  // Status filter — built from the org-configured learning statuses, plus a
  // synthetic "(No status)" bucket that matches learnings with no status set.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    learnings.forEach((i) => {
      const key = i.status || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [learnings]);

  const statusFilterItems: SearchFiltersItem[] = useMemo(() => {
    const items: SearchFiltersItem[] = learningStatuses.map((s) => {
      const count = statusCounts.get(s.id) || 0;
      return {
        id: `status-${s.id}`,
        name: (
          <Flex gap="2" align="center">
            <Badge
              label={s.label}
              color={s.color || "gray"}
              variant="soft"
              size="sm"
            />
            <span style={{ color: "var(--color-text-mid)" }}>({count})</span>
          </Flex>
        ),
        searchValue: s.id,
      };
    });
    const noStatusCount = statusCounts.get("") || 0;
    items.push({
      id: "status-none",
      name: (
        <Flex gap="2" align="center">
          <em style={{ color: "var(--color-text-mid)" }}>(No status)</em>
          <span style={{ color: "var(--color-text-mid)" }}>
            ({noStatusCount})
          </span>
        </Flex>
      ),
      searchValue: "",
    });
    return items;
  }, [learningStatuses, statusCounts]);

  // Project filter, inline with the other filters (matches the experiment
  // search/filter component).
  // Source filter — how each Learning was created (AI-discovered,
  // hand-written, or via the API).
  const sourceFilterItems: SearchFiltersItem[] = useMemo(() => {
    const labels: Record<string, string> = {
      ai: "AI-suggested",
      manual: "Written manually",
      api: "Created via API",
    };
    const counts = new Map<string, number>();
    learnings.forEach((i) => {
      const key = i.source || "manual";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        id: `source-${value}`,
        name: `${labels[value] || value} (${count})`,
        searchValue: value,
      }));
  }, [learnings]);

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    learnings.forEach((i) => {
      (i.projects || []).forEach((p) => {
        counts.set(p, (counts.get(p) || 0) + 1);
      });
    });
    return counts;
  }, [learnings]);

  const projectFilterItems: SearchFiltersItem[] = useMemo(
    () =>
      orgProjects
        .filter((p) => projectCounts.get(p.id))
        .map((p) => ({
          id: `project-${p.id}`,
          name: `${p.name} (${projectCounts.get(p.id)})`,
          searchValue: p.id,
        })),
    [orgProjects, projectCounts],
  );

  if (learnings.length === 0) {
    return (
      <>
        <EmptyState
          title="No Learnings yet"
          description="Use the Experiment Library tab to find common patterns across your experiments, save what you want to keep, or write one from scratch."
          rightButton={null}
          leftButton={null}
        />
      </>
    );
  }

  return (
    <>
      {error && (
        <Box mb="3">
          <Callout status="error">{error}</Callout>
        </Box>
      )}
      <Box mb="4">
        <Flex align="center" gap="3" justify="between" mb="3" wrap="wrap">
          <Flex align="center" gap="3" flexGrow="1" style={{ maxWidth: "75%" }}>
            <Box flexShrink="1" style={{ flexBasis: 240, minWidth: 140 }}>
              <Field
                placeholder="Search Learnings..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            {tagFilterItems.length > 0 && (
              <FilterDropdown
                filter="tag"
                heading="Tags"
                items={tagFilterItems}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={updateQuery}
              />
            )}
            {statusFilterItems.length > 0 && (
              <FilterDropdown
                filter="status"
                heading="Status"
                items={statusFilterItems}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={updateQuery}
              />
            )}
            {projectFilterItems.length > 0 && (
              <FilterDropdown
                filter="project"
                heading="Projects"
                items={projectFilterItems}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={updateQuery}
              />
            )}
            {sourceFilterItems.length > 1 && (
              <FilterDropdown
                filter="source"
                heading="Source"
                items={sourceFilterItems}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={updateQuery}
              />
            )}
          </Flex>
          <Flex align="center" gap="4" style={{ fontSize: "0.8rem" }}>
            <Flex align="center">
              <label className="mb-0 mr-2">From</label>
              <DatePicker
                date={startDate}
                setDate={(d) => setStartDate(d)}
                scheduleEndDate={endDate}
                precision="date"
                containerClassName=""
              />
            </Flex>
            <Flex align="center">
              <label className="mb-0 mr-2">To</label>
              <DatePicker
                date={endDate}
                setDate={(d) => setEndDate(d)}
                scheduleStartDate={startDate}
                precision="date"
                containerClassName=""
              />
            </Flex>
          </Flex>
        </Flex>
        <Flex gap="3" wrap="wrap" align="end">
          {(isFiltered || startDate || endDate) && (
            <Box>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearSearch();
                  setStartDate(undefined);
                  setEndDate(undefined);
                }}
              >
                Clear filters
              </Button>
            </Box>
          )}
        </Flex>
      </Box>
      {filteredLearnings.length === 0 ? (
        <Box py="4">
          <Text color="text-mid" as="div">
            No Learnings match your filters.
          </Text>
        </Box>
      ) : null}
      <Flex direction="column" gap="4">
        {filteredLearnings.map((learning) => {
          const ownerName = getOwnerDisplay(learning.owner) || "Unknown";
          const allowManage = learning.canManage;
          const edited =
            learning.dateUpdated &&
            learning.dateCreated &&
            getValidDate(learning.dateUpdated).getTime() -
              getValidDate(learning.dateCreated).getTime() >
              1000;
          const editorNames = (learning.authors || [])
            .filter((u) => u && u !== learning.owner)
            .map((u) => getOwnerDisplay(u) || "Unknown");
          return (
            <Box
              key={learning.id}
              p="4"
              style={{
                border: "1px solid var(--gray-a5)",
                borderRadius: 8,
                background: "var(--color-panel-solid)",
              }}
            >
              <Flex justify="between" align="start" gap="3" mb="2">
                <Flex gap="2" align="center" wrap="wrap">
                  <Heading as="h4" size="medium">
                    <Link
                      href={`/learnings/${learning.id}`}
                      style={{ color: "inherit" }}
                    >
                      {learning.title}
                    </Link>
                  </Heading>
                  {learning.source === "ai" && (
                    <Badge
                      label={
                        <Flex gap="1" align="center">
                          <PiSparkleFill /> AI-suggested
                        </Flex>
                      }
                      color="violet"
                      variant="soft"
                      size="sm"
                    />
                  )}
                  {learning.status &&
                    (() => {
                      const s = statusMap.get(learning.status);
                      return (
                        <Badge
                          label={s?.label || learning.status}
                          color={s?.color || "gray"}
                          variant="soft"
                          size="sm"
                          title={
                            s
                              ? undefined
                              : "This status no longer exists in settings"
                          }
                        />
                      );
                    })()}
                </Flex>
                {allowManage && (
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                        aria-label="Learning actions"
                      >
                        <BsThreeDotsVertical size={16} />
                      </IconButton>
                    }
                    menuPlacement="end"
                  >
                    <DropdownMenuItem onClick={() => setPendingEdit(learning)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!aiEnabled}
                      tooltip={
                        aiEnabled
                          ? "Re-checks this Learning against experiments that finished since it was last reviewed, and suggests updated wording plus any new supporting or contradicting experiments. Nothing changes until you review and apply."
                          : "AI features are not enabled for this organization."
                      }
                      onClick={() => setPendingRefresh(learning)}
                    >
                      Refresh against newer experiments
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      color="red"
                      onClick={() => setPendingDelete(learning)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenu>
                )}
              </Flex>
              <Box mb="3">
                <Text size="small" color="text-mid" as="div">
                  Created {date(learning.dateCreated)} by {ownerName}
                  {edited ? ` · edited ${date(learning.dateUpdated)}` : ""}
                  {editorNames.length > 0
                    ? ` · also edited by ${editorNames.join(", ")}`
                    : ""}
                </Text>
                {learning.projects && learning.projects.length > 0 && (
                  <Box mt="1">
                    <Flex gap="2" wrap="wrap" align="center">
                      <Text size="small" color="text-mid">
                        Projects:
                      </Text>
                      {learning.projects.map((p) => (
                        <Badge
                          key={p}
                          label={getProjectById(p)?.name || p}
                          color="gray"
                          variant="soft"
                          size="sm"
                        />
                      ))}
                    </Flex>
                  </Box>
                )}
              </Box>
              <Box mb="3">
                <Markdown>{learning.text}</Markdown>
              </Box>
              {learning.tags && learning.tags.length > 0 && (
                <Box mb="3">
                  <Flex gap="2" wrap="wrap">
                    {learning.tags.map((t) => {
                      const active = syntaxFilters.some(
                        (f) =>
                          f.field === "tag" &&
                          f.values.some(
                            (v) => v.toLowerCase() === t.toLowerCase(),
                          ),
                      );
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            updateQuery({
                              field: "tag",
                              values: [t],
                              operator: "",
                              negated: false,
                            })
                          }
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                          }}
                          aria-pressed={active}
                        >
                          <Badge
                            label={t}
                            color="violet"
                            variant={active ? "solid" : "soft"}
                            size="sm"
                          />
                        </button>
                      );
                    })}
                  </Flex>
                </Box>
              )}
              <Flex direction="column" gap="3" mb="3">
                <ExperimentChips
                  label="Supporting experiments"
                  experimentIds={learning.supportingExperimentIds}
                  experimentMap={experimentMap}
                />
                <ExperimentChips
                  label="Contradicting experiments"
                  experimentIds={learning.contradictingExperimentIds || []}
                  experimentMap={experimentMap}
                  variant="contrary"
                />
              </Flex>
              <Box pt="3" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                <CollapsibleDiscussion
                  type="learning"
                  id={learning.id}
                  projects={learning.projects || []}
                  commentCount={commentCountsData?.counts?.[learning.id] ?? 0}
                />
              </Box>
            </Box>
          );
        })}
      </Flex>
      {pendingRefresh && (
        <RefreshLearningsModal
          experiments={experiments}
          learningIds={[pendingRefresh.id]}
          close={() => setPendingRefresh(null)}
          onApplied={() => {
            setPendingRefresh(null);
            mutate();
          }}
        />
      )}
      {pendingEdit && (
        <EditLearningModal
          learning={pendingEdit}
          experiments={experiments}
          close={() => setPendingEdit(null)}
          onSaved={() => {
            setPendingEdit(null);
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title="Delete this learning?"
        subtitle="This action cannot be undone."
        yesText="Yes, delete it"
        noText="Cancel"
        modalState={!!pendingDelete}
        setModalState={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setError(null);
          try {
            await apiCall(`/learnings/${pendingDelete.id}`, {
              method: "DELETE",
            });
            setPendingDelete(null);
            mutate();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not delete");
            setPendingDelete(null);
          }
        }}
      />
    </>
  );
};

export default SavedLearningsList;
