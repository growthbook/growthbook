import { FC, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPencilSimple, PiSparkleFill, PiTrash, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { InsightWithCanManage } from "shared/validators";
import { date, getValidDate } from "shared/dates";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import EmptyState from "@/components/EmptyState";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ConfirmModal from "@/components/ConfirmModal";
import CollapsibleDiscussion from "@/components/CollapsibleDiscussion";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import {
  FilterDropdown,
  SearchFiltersItem,
} from "@/components/Search/SearchFilters";
import { SyntaxFilter } from "@/services/search";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import EditInsightModal from "./EditInsightModal";
import ExperimentChips from "./ExperimentChips";

const SavedInsightsList: FC<{
  insights: InsightWithCanManage[];
  experiments: ExperimentInterfaceStringDates[];
  /** Default projects to use for newly-created learnings. */
  newLearningProjects?: string[];
  mutate: () => void;
}> = ({ insights, experiments, newLearningProjects, mutate }) => {
  const { apiCall } = useAuth();
  const { getOwnerDisplay } = useUser();
  const { projects: orgProjects, getProjectById } = useDefinitions();
  const orgSettings = useOrgSettings();
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
  const statusMap = useMemo(
    () => new Map(learningStatuses.map((s) => [s.id, s])),
    [learningStatuses],
  );
  const [pendingDelete, setPendingDelete] =
    useState<InsightWithCanManage | null>(null);
  const [pendingEdit, setPendingEdit] = useState<InsightWithCanManage | null>(
    null,
  );
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  // Each entry is a status id, or "" (empty string) for the "(No status)" bucket.
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [openFilter, setOpenFilter] = useState<string>("");

  const experimentMap = new Map(experiments.map((e) => [e.id, e]));

  // Batch-fetch comment counts for all insights in one request so each card
  // doesn't fire its own discussion fetch just to render a count.
  const insightIdsKey = useMemo(
    () =>
      insights
        .map((i) => i.id)
        .sort()
        .join(","),
    [insights],
  );
  const { data: commentCountsData } = useApi<{
    counts: Record<string, number>;
  }>(`/discussions/counts/insight?ids=${insightIdsKey}`, {
    shouldRun: () => insightIdsKey.length > 0,
  });

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    insights.forEach((i) => {
      (i.tags || []).forEach((t) => {
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [insights]);

  const tagFilterItems: SearchFiltersItem[] = useMemo(
    () =>
      allTags.map(([t, c]) => ({
        id: `tag-${t}`,
        name: `${t} (${c})`,
        searchValue: t,
      })),
    [allTags],
  );

  // FilterDropdown reads selection from a SyntaxFilter[] and reports clicks via
  // updateQuery. We mirror our local selectedTags state through that contract so
  // the dropdown shows checkmarks and toggles correctly.
  const tagSyntaxFilters: SyntaxFilter[] = useMemo(
    () =>
      selectedTags.length > 0
        ? [
            {
              field: "tag",
              values: selectedTags,
              operator: "" as const,
              negated: false,
            },
          ]
        : [],
    [selectedTags],
  );

  const handleTagUpdateQuery = (f: SyntaxFilter) => {
    const tag = f.values[0];
    if (!tag) return;
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  };

  // Status filter — built from the org-configured learning statuses, plus a
  // synthetic "(No status)" bucket that matches learnings with no status set.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    insights.forEach((i) => {
      const key = i.status || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [insights]);

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

  const statusSyntaxFilters: SyntaxFilter[] = useMemo(
    () =>
      selectedStatuses.length > 0
        ? [
            {
              field: "status",
              values: selectedStatuses,
              operator: "" as const,
              negated: false,
            },
          ]
        : [],
    [selectedStatuses],
  );

  const handleStatusUpdateQuery = (f: SyntaxFilter) => {
    if (f.values.length === 0) return;
    const value = f.values[0];
    setSelectedStatuses((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  };

  const projectOptions = useMemo(
    () => orgProjects.map((p) => ({ label: p.name, value: p.id })),
    [orgProjects],
  );

  const filteredInsights = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedTagSet = new Set(selectedTags);
    const selectedProjectSet = new Set(selectedProjects);
    const selectedStatusSet = new Set(selectedStatuses);

    return insights.filter((i) => {
      // Tag filter (AND across selected tags)
      if (selectedTagSet.size > 0) {
        const tagSet = new Set(i.tags || []);
        for (const t of selectedTagSet) {
          if (!tagSet.has(t)) return false;
        }
      }

      // Project filter — match if the insight has at least one of the selected
      // projects, OR if it has no projects (lives in "All projects")
      if (selectedProjectSet.size > 0) {
        const insightProjects = i.projects || [];
        if (insightProjects.length > 0) {
          const overlaps = insightProjects.some((p) =>
            selectedProjectSet.has(p),
          );
          if (!overlaps) return false;
        }
      }

      // Status filter (OR across selected statuses). Empty string is the
      // "(No status)" bucket — matches insights with no status set.
      if (selectedStatusSet.size > 0) {
        const key = i.status || "";
        if (!selectedStatusSet.has(key)) return false;
      }

      // Date range — filter on dateCreated
      if (startDate || endDate) {
        const created = getValidDate(i.dateCreated);
        if (startDate && created < startDate) return false;
        if (endDate && created > endDate) return false;
      }

      // Text search
      if (q) {
        const hay = [i.title || "", i.text || "", ...(i.tags || [])]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    insights,
    search,
    selectedTags,
    selectedProjects,
    selectedStatuses,
    startDate,
    endDate,
  ]);

  const anyFilterActive =
    !!search ||
    selectedTags.length > 0 ||
    selectedProjects.length > 0 ||
    selectedStatuses.length > 0 ||
    !!startDate ||
    !!endDate;

  // Chips showing the currently-selected Tag and Status filters (which are
  // otherwise only visible when the dropdown is open). Each removes itself.
  const activeFilterChips = useMemo(() => {
    const chips: {
      key: string;
      label: string;
      color: RadixColor;
      onRemove: () => void;
    }[] = [];
    selectedStatuses.forEach((s) => {
      chips.push({
        key: `status-${s}`,
        label: s === "" ? "No status" : statusMap.get(s)?.label || s,
        color: statusMap.get(s)?.color || "gray",
        onRemove: () =>
          setSelectedStatuses((prev) => prev.filter((x) => x !== s)),
      });
    });
    selectedTags.forEach((t) => {
      chips.push({
        key: `tag-${t}`,
        label: t,
        color: "violet",
        onRemove: () => setSelectedTags((prev) => prev.filter((x) => x !== t)),
      });
    });
    return chips;
  }, [selectedStatuses, selectedTags, statusMap]);

  if (insights.length === 0) {
    return (
      <>
        <EmptyState
          title="No saved insights yet"
          description="Use the Experiment Results tab to find common patterns across your experiments, save what you want to keep, or write one from scratch."
          rightButton={null}
          leftButton={
            <Button onClick={() => setShowNew(true)}>New saved learning</Button>
          }
        />
        {showNew && (
          <EditInsightModal
            experiments={experiments}
            defaultProjects={newLearningProjects}
            close={() => setShowNew(false)}
            onSaved={() => {
              setShowNew(false);
              mutate();
            }}
          />
        )}
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
      <Flex justify="end" mb="3">
        <Button onClick={() => setShowNew(true)}>New saved learning</Button>
      </Flex>
      <Box mb="4">
        <Flex align="center" gap="3" justify="between" mb="3" wrap="wrap">
          <Flex align="center" gap="4" flexGrow="1" style={{ maxWidth: "60%" }}>
            <Box flexGrow="1">
              <Field
                placeholder="Search saved learnings..."
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Box>
            {tagFilterItems.length > 0 && (
              <FilterDropdown
                filter="tag"
                heading="Tags"
                items={tagFilterItems}
                syntaxFilters={tagSyntaxFilters}
                open={openFilter}
                setOpen={setOpenFilter}
                updateQuery={handleTagUpdateQuery}
              />
            )}
            {statusFilterItems.length > 0 && (
              <FilterDropdown
                filter="status"
                heading="Status"
                items={statusFilterItems}
                syntaxFilters={statusSyntaxFilters}
                open={openFilter}
                setOpen={setOpenFilter}
                updateQuery={handleStatusUpdateQuery}
              />
            )}
          </Flex>
          <Flex align="center" gap="4" style={{ fontSize: "0.8rem" }}>
            <Flex align="center">
              <Text as="label" mr="2" mb="0">
                From
              </Text>
              <DatePicker
                date={startDate}
                setDate={(d) => setStartDate(d)}
                scheduleEndDate={endDate}
                precision="date"
                containerClassName=""
              />
            </Flex>
            <Flex align="center">
              <Text as="label" mr="2" mb="0">
                To
              </Text>
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
          {projectOptions.length > 0 && (
            <Box style={{ minWidth: 200, flexGrow: 1, maxWidth: 360 }}>
              <MultiSelectField
                label="Projects"
                placeholder="All projects"
                value={selectedProjects}
                options={projectOptions}
                onChange={setSelectedProjects}
              />
            </Box>
          )}
        </Flex>
        {anyFilterActive && (
          <Flex align="center" gap="2" wrap="wrap" justify="between" mt="3">
            <Flex gap="2" wrap="wrap" align="center">
              {activeFilterChips.length > 0 && (
                <Text size="small" color="text-mid">
                  Active filters:
                </Text>
              )}
              {activeFilterChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.onRemove}
                  aria-label={`Remove ${c.label} filter`}
                  title="Remove filter"
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <Badge
                    color={c.color}
                    variant="solid"
                    size="sm"
                    label={
                      <Flex as="span" align="center" gap="1">
                        {c.label}
                        <PiX />
                      </Flex>
                    }
                  />
                </button>
              ))}
            </Flex>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSelectedTags([]);
                setSelectedProjects([]);
                setSelectedStatuses([]);
                setStartDate(undefined);
                setEndDate(undefined);
              }}
            >
              Clear filters
            </Button>
          </Flex>
        )}
      </Box>
      {filteredInsights.length === 0 ? (
        <Box py="4">
          <Text color="text-mid" as="div">
            No saved learnings match your filters.
          </Text>
        </Box>
      ) : null}
      <Flex direction="column" gap="4">
        {filteredInsights.map((insight) => {
          const ownerName = getOwnerDisplay(insight.owner) || "Unknown";
          const allowManage = insight.canManage;
          const edited =
            insight.dateUpdated &&
            insight.dateCreated &&
            getValidDate(insight.dateUpdated).getTime() -
              getValidDate(insight.dateCreated).getTime() >
              1000;
          const editorNames = (insight.authors || [])
            .filter((u) => u && u !== insight.owner)
            .map((u) => getOwnerDisplay(u) || "Unknown");
          return (
            <Box
              key={insight.id}
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
                      href={`/learnings/${insight.id}`}
                      style={{ color: "inherit" }}
                    >
                      {insight.title}
                    </Link>
                  </Heading>
                  {insight.source === "ai" && (
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
                  {insight.status &&
                    (() => {
                      const s = statusMap.get(insight.status);
                      return (
                        <Badge
                          label={s?.label || insight.status}
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
                  <Flex gap="1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingEdit(insight)}
                      aria-label="Edit insight"
                    >
                      <PiPencilSimple />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(insight)}
                      aria-label="Delete insight"
                    >
                      <PiTrash />
                    </Button>
                  </Flex>
                )}
              </Flex>
              <Box mb="3">
                <Text size="small" color="text-mid" as="div">
                  Created {date(insight.dateCreated)} by {ownerName}
                  {edited ? ` · edited ${date(insight.dateUpdated)}` : ""}
                  {editorNames.length > 0
                    ? ` · also edited by ${editorNames.join(", ")}`
                    : ""}
                </Text>
                {insight.projects && insight.projects.length > 0 && (
                  <Box mt="1">
                    <Flex gap="2" wrap="wrap" align="center">
                      <Text size="small" color="text-mid">
                        Projects:
                      </Text>
                      {insight.projects.map((p) => (
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
                <Markdown>{insight.text}</Markdown>
              </Box>
              {insight.tags && insight.tags.length > 0 && (
                <Box mb="3">
                  <Flex gap="2" wrap="wrap">
                    {insight.tags.map((t) => {
                      const active = selectedTags.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setSelectedTags((prev) =>
                              prev.includes(t)
                                ? prev.filter((x) => x !== t)
                                : [...prev, t],
                            );
                          }}
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
                  experimentIds={insight.supportingExperimentIds}
                  experimentMap={experimentMap}
                />
                <ExperimentChips
                  label="Contrary evidence"
                  experimentIds={insight.contraryEvidence || []}
                  experimentMap={experimentMap}
                  variant="contrary"
                />
              </Flex>
              <Box pt="3" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                <CollapsibleDiscussion
                  type="insight"
                  id={insight.id}
                  projects={insight.projects || []}
                  commentCount={commentCountsData?.counts?.[insight.id] ?? 0}
                />
              </Box>
            </Box>
          );
        })}
      </Flex>
      {pendingEdit && (
        <EditInsightModal
          insight={pendingEdit}
          experiments={experiments}
          close={() => setPendingEdit(null)}
          onSaved={() => {
            setPendingEdit(null);
            mutate();
          }}
        />
      )}
      {showNew && (
        <EditInsightModal
          experiments={experiments}
          defaultProjects={newLearningProjects}
          close={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title="Delete this insight?"
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
            await apiCall(`/insights/${pendingDelete.id}`, {
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

export default SavedInsightsList;
