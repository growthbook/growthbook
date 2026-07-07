import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AiInsightSuggestion } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiSparkleFill } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Modal from "@/ui/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
import ExperimentChips from "./ExperimentChips";

type SuggestionState = {
  suggestion: AiInsightSuggestion;
  saved: boolean;
  saving: boolean;
  error?: string;
};

const CONFIDENCE_COLORS: Record<
  NonNullable<AiInsightSuggestion["confidence"]>,
  "green" | "amber" | "gray"
> = {
  high: "green",
  medium: "amber",
  low: "gray",
};

const FindInsightsModal: FC<{
  experiments: ExperimentInterfaceStringDates[];
  /** Project ids to attach to any insights the user saves. */
  saveProjects?: string[];
  close: () => void;
  onSaved?: () => void;
}> = ({ experiments, saveProjects, close, onSaved }) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  // When the back-end caps very large sets, it analyzes the most recent N
  // and reports both numbers so we can tell the user.
  const [analyzedCounts, setAnalyzedCounts] = useState<{
    requested: number;
    analyzed: number;
  } | null>(null);

  // Stable key derived from the actual experiment IDs. We depend on this
  // rather than the experiments array reference so that SWR-driven
  // re-renders of the parent (e.g. on tab focus / revalidation) don't cause
  // us to re-fire the expensive AI generation when the underlying set of
  // experiments hasn't actually changed.
  const experimentIdsKey = useMemo(
    () =>
      experiments
        .map((e) => e.id)
        .sort()
        .join(","),
    [experiments],
  );

  // Guard against React strict-mode double invocation in dev and any other
  // accidental re-runs for the same set of experiments while this modal
  // instance is open. The user explicitly clicks "Find insights" to open
  // the modal; we never want a passive event (tab switch, focus return) to
  // re-trigger AI generation.
  const lastFetchedKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastFetchedKey.current === experimentIdsKey) return;
    lastFetchedKey.current = experimentIdsKey;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const ids = experimentIdsKey ? experimentIdsKey.split(",") : [];
        const res = await apiCall<{
          status: number;
          insights?: AiInsightSuggestion[];
          message?: string;
          numExperimentsRequested?: number;
          numExperimentsAnalyzed?: number;
        }>("/insights/find", {
          method: "POST",
          body: JSON.stringify({
            experimentIds: ids,
          }),
        });
        if (cancelled) return;
        if (res.status !== 200 || !res.insights) {
          setError(res.message || "Could not generate insights");
        } else {
          setSuggestions(
            res.insights.map((s) => ({
              suggestion: s,
              saved: false,
              saving: false,
            })),
          );
          if (
            res.numExperimentsRequested !== undefined &&
            res.numExperimentsAnalyzed !== undefined &&
            res.numExperimentsAnalyzed < res.numExperimentsRequested
          ) {
            setAnalyzedCounts({
              requested: res.numExperimentsRequested,
              analyzed: res.numExperimentsAnalyzed,
            });
          } else {
            setAnalyzedCounts(null);
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : "Failed to generate insights",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [apiCall, experimentIdsKey]);

  const experimentMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  async function persistSuggestion(item: SuggestionState) {
    await apiCall("/insights", {
      method: "POST",
      body: JSON.stringify({
        title: item.suggestion.title,
        text: item.suggestion.text,
        tags: item.suggestion.tags || [],
        supportingExperimentIds: item.suggestion.supportingExperimentIds,
        contraryEvidence: item.suggestion.contraryExperimentIds || [],
        projects: saveProjects || [],
        source: "ai",
      }),
    });
  }

  async function saveSuggestion(index: number) {
    const item = suggestions[index];
    if (!item || item.saved || item.saving) return;
    setSuggestions((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, saving: true, error: undefined } : s,
      ),
    );
    try {
      await persistSuggestion(item);
      setSuggestions((prev) =>
        prev.map((s, i) =>
          i === index ? { ...s, saved: true, saving: false } : s,
        ),
      );
      if (onSaved) onSaved();
    } catch (e) {
      setSuggestions((prev) =>
        prev.map((s, i) =>
          i === index
            ? {
                ...s,
                saving: false,
                error: e instanceof Error ? e.message : "Could not save",
              }
            : s,
        ),
      );
    }
  }

  // Save every not-yet-saved suggestion. Runs sequentially so one failure
  // doesn't abort the rest, and each card reflects its own saved/error state.
  async function saveAll() {
    const indexes = suggestions
      .map((s, i) => i)
      .filter((i) => !suggestions[i].saved && !suggestions[i].saving);
    if (!indexes.length) return;

    setSavingAll(true);
    setSuggestions((prev) =>
      prev.map((s) => (s.saved ? s : { ...s, saving: true, error: undefined })),
    );

    let anySaved = false;
    for (const index of indexes) {
      try {
        await persistSuggestion(suggestions[index]);
        anySaved = true;
        setSuggestions((prev) =>
          prev.map((s, i) =>
            i === index ? { ...s, saved: true, saving: false } : s,
          ),
        );
      } catch (e) {
        setSuggestions((prev) =>
          prev.map((s, i) =>
            i === index
              ? {
                  ...s,
                  saving: false,
                  error: e instanceof Error ? e.message : "Could not save",
                }
              : s,
          ),
        );
      }
    }
    if (anySaved && onSaved) onSaved();
    setSavingAll(false);
  }

  const unsavedCount = suggestions.filter((s) => !s.saved).length;

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      trackingEventModalType="find-insights"
    >
      <Modal.Header>
        <Modal.Title>
          <Flex align="center" gap="2">
            <PiSparkleFill /> Find Insights Across Experiments
          </Flex>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && (
          <Flex direction="column" align="center" gap="3" py="6">
            <LoadingSpinner />
            <Text size="medium" color="text-mid">
              Analyzing {experiments.length} experiments to find common
              themes...
            </Text>
          </Flex>
        )}
        {!loading && error && <Callout status="error">{error}</Callout>}
        {!loading && !error && suggestions.length === 0 && (
          <Callout status="info">
            No meaningful cross-experiment patterns were found in this set. Try
            expanding the date range or including more experiments.
          </Callout>
        )}
        {!loading && !error && analyzedCounts && (
          <Box mb="3">
            <Callout status="info">
              Analyzed the {analyzedCounts.analyzed} most recent experiments out
              of the {analyzedCounts.requested} selected. Narrow your filters to
              analyze a specific subset.
            </Callout>
          </Box>
        )}
        {!loading && !error && suggestions.length > 0 && (
          <Box>
            <Box mb="3">
              <Text size="medium" color="text-mid" as="div">
                Found {suggestions.length} potential insight
                {suggestions.length === 1 ? "" : "s"}. Review each one and save
                the ones you want to keep.
              </Text>
            </Box>
            <Flex direction="column" gap="4">
              {suggestions.map((s, i) => (
                <Box
                  key={i}
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
                        {s.suggestion.title}
                      </Heading>
                      {s.suggestion.confidence && (
                        <Badge
                          label={`${s.suggestion.confidence} confidence`}
                          color={CONFIDENCE_COLORS[s.suggestion.confidence]}
                          variant="soft"
                          size="sm"
                        />
                      )}
                    </Flex>
                    {s.saved ? (
                      <Text size="medium" color="text-mid">
                        Saved
                      </Text>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => saveSuggestion(i)}
                        disabled={s.saving}
                      >
                        {s.saving ? "Saving..." : "Save"}
                      </Button>
                    )}
                  </Flex>
                  <Box mb="3">
                    <Markdown>{s.suggestion.text}</Markdown>
                  </Box>
                  {s.suggestion.tags && s.suggestion.tags.length > 0 && (
                    <Box mb="3">
                      <Flex gap="2" wrap="wrap">
                        {s.suggestion.tags.map((t) => (
                          <Badge
                            key={t}
                            label={t}
                            color="violet"
                            variant="soft"
                            size="sm"
                          />
                        ))}
                      </Flex>
                    </Box>
                  )}
                  <Flex direction="column" gap="3">
                    <ExperimentChips
                      label="Supporting experiments"
                      experimentIds={s.suggestion.supportingExperimentIds}
                      experimentMap={experimentMap}
                    />
                    <ExperimentChips
                      label="Contrary evidence"
                      experimentIds={s.suggestion.contraryExperimentIds || []}
                      experimentMap={experimentMap}
                      variant="contrary"
                    />
                  </Flex>
                  {s.error && (
                    <Box mt="2">
                      <Callout status="error" size="sm">
                        {s.error}
                      </Callout>
                    </Box>
                  )}
                </Box>
              ))}
            </Flex>
          </Box>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Flex gap="3" align="center" justify="end">
          {unsavedCount > 1 && (
            <Button variant="outline" onClick={saveAll} disabled={savingAll}>
              {savingAll ? "Saving..." : `Save all (${unsavedCount})`}
            </Button>
          )}
          <Modal.Close>
            <Button variant="solid" onClick={close}>
              Done
            </Button>
          </Modal.Close>
        </Flex>
      </Modal.Footer>
    </Modal.Root>
  );
};

export default FindInsightsModal;
