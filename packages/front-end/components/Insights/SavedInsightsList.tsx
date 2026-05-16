import { FC, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPencilSimple, PiTrash } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date, getValidDate } from "shared/dates";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import EmptyState from "@/components/EmptyState";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
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
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import EditInsightModal from "./EditInsightModal";

type FrontEndInsight = {
  id: string;
  organization: string;
  owner: string;
  authors?: string[];
  title: string;
  text: string;
  tags?: string[];
  supportingExperimentIds: string[];
  contraryEvidence?: string[];
  projects?: string[];
  status?: string;
  dateCreated: string;
  dateUpdated: string;
};

const SavedInsightsList: FC<{
  insights: FrontEndInsight[];
  experiments: ExperimentInterfaceStringDates[];
  /** Default projects to use for newly-created learnings. */
  newLearningProjects?: string[];
  mutate: () => void;
}> = ({ insights, experiments, newLearningProjects, mutate }) => {
  const { apiCall } = useAuth();
  const { userId, superAdmin, getOwnerDisplay } = useUser();
  const { projects: orgProjects, getProjectById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const orgSettings = useOrgSettings();
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
  const statusMap = useMemo(
    () => new Map(learningStatuses.map((s) => [s.id, s])),
    [learningStatuses],
  );
  const [pendingDelete, setPendingDelete] = useState<FrontEndInsight | null>(
    null,
  );
  const [pendingEdit, setPendingEdit] = useState<FrontEndInsight | null>(null);
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

  const canManage = (insight: FrontEndInsight) => {
    if (insight.owner && insight.owner === userId) return true;
    if (superAdmin) return true;
    return permissionsUtil.canManageOrgSettings();
  };

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
          {anyFilterActive && (
            <Box>
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
            </Box>
          )}
        </Flex>
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
          const allowManage = canManage(insight);
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
                    {insight.title}
                  </Heading>
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
              {insight.supportingExperimentIds.length > 0 && (
                <Box mb="3">
                  <Box mb="1">
                    <Text
                      size="small"
                      weight="semibold"
                      color="text-mid"
                      as="div"
                    >
                      Supporting experiments (
                      {insight.supportingExperimentIds.length})
                    </Text>
                  </Box>
                  <Flex gap="2" wrap="wrap">
                    {insight.supportingExperimentIds.map((id) => {
                      const exp = experimentMap.get(id);
                      return (
                        <Link
                          key={id}
                          href={`/experiment/${id}`}
                          style={{
                            fontSize: 13,
                            padding: "2px 8px",
                            border: "1px solid var(--gray-a5)",
                            borderRadius: 4,
                          }}
                        >
                          {exp?.name || id}
                        </Link>
                      );
                    })}
                  </Flex>
                </Box>
              )}
              {insight.contraryEvidence &&
                insight.contraryEvidence.length > 0 && (
                  <Box mb="4">
                    <Box mb="1">
                      <Text
                        size="small"
                        weight="semibold"
                        color="text-mid"
                        as="div"
                      >
                        Contrary evidence ({insight.contraryEvidence.length})
                      </Text>
                    </Box>
                    <Flex gap="2" wrap="wrap">
                      {insight.contraryEvidence.map((id) => {
                        const exp = experimentMap.get(id);
                        return (
                          <Link
                            key={id}
                            href={`/experiment/${id}`}
                            style={{
                              fontSize: 13,
                              padding: "2px 8px",
                              border: "1px solid var(--red-a5)",
                              borderRadius: 4,
                              color: "var(--red-11)",
                            }}
                          >
                            {exp?.name || id}
                          </Link>
                        );
                      })}
                    </Flex>
                  </Box>
                )}
              <Box pt="3" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                <CollapsibleDiscussion
                  type="insight"
                  id={insight.id}
                  projects={insight.projects || []}
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
