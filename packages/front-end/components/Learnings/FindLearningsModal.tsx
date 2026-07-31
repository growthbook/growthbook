import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AiLearningSuggestion } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiSparkleFill } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Modal from "@/ui/Modal";
import Checkbox from "@/ui/Checkbox";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
import ExperimentChips from "./ExperimentChips";

type SuggestionState = {
  suggestion: AiLearningSuggestion;
  /** Checked suggestions are persisted when the modal is submitted. */
  selected: boolean;
};

const FindLearningsModal: FC<{
  experiments: ExperimentInterfaceStringDates[];
  /** Project ids to attach to any learnings the user saves. */
  saveProjects?: string[];
  close: () => void;
  onSaved?: () => void;
}> = ({ experiments, saveProjects, close, onSaved }) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([]);
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
  // instance is open. The user explicitly clicks "Find learnings" to open
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
          learnings?: AiLearningSuggestion[];
          message?: string;
          numExperimentsRequested?: number;
          numExperimentsAnalyzed?: number;
        }>("/learnings/find", {
          method: "POST",
          body: JSON.stringify({
            experimentIds: ids,
          }),
        });
        if (cancelled) return;
        if (res.status !== 200 || !res.learnings) {
          setError(res.message || "Could not generate learnings");
        } else {
          setSuggestions(
            res.learnings.map((s) => ({
              suggestion: s,
              selected: false,
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
          e instanceof Error ? e.message : "Failed to generate learnings",
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

  function toggleSuggestion(index: number) {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  }

  const selectedCount = suggestions.filter((s) => s.selected).length;

  // Saving happens on submit so selections stay reversible while reviewing.
  async function saveSelected() {
    const chosen = suggestions.filter((s) => s.selected);
    if (!chosen.length) {
      close();
      return;
    }
    for (const item of chosen) {
      await apiCall("/learnings", {
        method: "POST",
        body: JSON.stringify({
          title: item.suggestion.title,
          text: item.suggestion.text,
          tags: item.suggestion.tags || [],
          supportingExperimentIds: item.suggestion.supportingExperimentIds,
          contradictingExperimentIds:
            item.suggestion.contradictingExperimentIds || [],
          projects: saveProjects || [],
          source: "ai",
        }),
      });
    }
    if (onSaved) onSaved();
    close();
  }

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      trackingEventModalType="find-learnings"
    >
      <Modal.Header>
        <Modal.Title>
          <Flex align="center" gap="2">
            <PiSparkleFill /> Find Learnings Across Experiments
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
                Found {suggestions.length} potential learning
                {suggestions.length === 1 ? "" : "s"}. Check the ones you want
                to keep, then save.
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
                  <Flex align="start" gap="3" mb="2">
                    <Checkbox
                      value={s.selected}
                      setValue={() => toggleSuggestion(i)}
                      label={
                        <Heading as="h4" size="medium" mb="0">
                          {s.suggestion.title}
                        </Heading>
                      }
                      mb="0"
                    />
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
                      label="Contradicting experiments"
                      experimentIds={
                        s.suggestion.contradictingExperimentIds || []
                      }
                      experimentMap={experimentMap}
                      variant="contrary"
                    />
                  </Flex>
                </Box>
              ))}
            </Flex>
          </Box>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </Modal.Close>
        <Button
          variant="solid"
          disabled={selectedCount === 0}
          onClick={saveSelected}
        >
          {selectedCount > 0 ? `Save ${selectedCount}` : "Save"}
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
};

export default FindLearningsModal;
