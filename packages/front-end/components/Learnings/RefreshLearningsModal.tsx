import { FC, useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { LearningRefreshSuggestion } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiArrowsClockwise } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Modal from "@/ui/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
import ExperimentChips from "./ExperimentChips";

type SuggestionState = {
  suggestion: LearningRefreshSuggestion;
  selected: boolean;
};

/**
 * Re-checks saved Learnings against experiments that stopped since each one
 * was last reviewed, and lets the user apply the proposed updates.
 */
const RefreshLearningsModal: FC<{
  experiments: ExperimentInterfaceStringDates[];
  close: () => void;
  onApplied?: () => void;
}> = ({ experiments, close, onApplied }) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([]);
  const [applying, setApplying] = useState(false);
  const [checked, setChecked] = useState<{
    learnings: number;
    experiments: number;
  } | null>(null);

  const experimentMap = new Map(experiments.map((e) => [e.id, e]));

  // Refresh is an expensive AI call — only ever fire it once per modal.
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiCall<{
          status: number;
          suggestions?: LearningRefreshSuggestion[];
          numLearningsChecked?: number;
          numExperimentsConsidered?: number;
          message?: string;
        }>("/learnings/refresh", {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (cancelled) return;
        if (res.status !== 200 || !res.suggestions) {
          setError(res.message || "Could not refresh Learnings");
        } else {
          setSuggestions(
            res.suggestions.map((s) => ({ suggestion: s, selected: true })),
          );
          setChecked({
            learnings: res.numLearningsChecked ?? 0,
            experiments: res.numExperimentsConsidered ?? 0,
          });
        }
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : "Could not refresh Learnings",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [apiCall]);

  function toggle(index: number) {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  }

  const selectedCount = suggestions.filter((s) => s.selected).length;

  async function applySelected() {
    const chosen = suggestions.filter((s) => s.selected);
    if (!chosen.length) {
      close();
      return;
    }
    setApplying(true);
    setError(null);
    try {
      for (const { suggestion } of chosen) {
        await apiCall(`/learnings/${suggestion.learningId}/apply-refresh`, {
          method: "POST",
          body: JSON.stringify({
            text: suggestion.updatedText,
            addSupportingExperimentIds: suggestion.newSupportingExperimentIds,
            addContradictingExperimentIds:
              suggestion.newContradictingExperimentIds,
          }),
        });
      }
      if (onApplied) onApplied();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply updates");
      setApplying(false);
    }
  }

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      trackingEventModalType="refresh-learnings"
    >
      <Modal.Header>
        <Modal.Title>
          <Flex align="center" gap="2">
            <PiArrowsClockwise /> Refresh Learnings
          </Flex>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && (
          <Flex direction="column" align="center" gap="3" py="6">
            <LoadingSpinner />
            <Text size="medium" color="text-mid">
              Checking saved Learnings against recently stopped experiments...
            </Text>
          </Flex>
        )}
        {!loading && error && <Callout status="error">{error}</Callout>}
        {!loading && !error && suggestions.length === 0 && (
          <Callout status="success">
            All Learnings are up to date
            {checked
              ? ` — checked ${checked.learnings} Learning${
                  checked.learnings === 1 ? "" : "s"
                } against ${checked.experiments} newer experiment${
                  checked.experiments === 1 ? "" : "s"
                }.`
              : "."}
          </Callout>
        )}
        {!loading && !error && suggestions.length > 0 && (
          <Box>
            <Box mb="3">
              <Text size="medium" color="text-mid" as="div">
                {suggestions.length} Learning
                {suggestions.length === 1 ? " has" : "s have"} proposed updates
                from newer experiments. Uncheck anything you don&apos;t want to
                apply.
              </Text>
            </Box>
            <Flex direction="column" gap="4">
              {suggestions.map((s, i) => (
                <Box
                  key={s.suggestion.learningId}
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
                      setValue={() => toggle(i)}
                      label={
                        <Heading as="h4" size="medium" mb="0">
                          {s.suggestion.title}
                        </Heading>
                      }
                      mb="0"
                    />
                  </Flex>
                  {!s.suggestion.stillAccurate && (
                    <Box mb="3">
                      <Callout status="warning" size="sm">
                        New evidence contradicts this Learning.
                      </Callout>
                    </Box>
                  )}
                  {s.suggestion.summary && (
                    <Box mb="3">
                      <Text size="medium" color="text-mid" as="div">
                        {s.suggestion.summary}
                      </Text>
                    </Box>
                  )}
                  {s.suggestion.updatedText !== s.suggestion.currentText && (
                    <Box mb="3">
                      <Text size="small" weight="semibold" color="text-mid">
                        Updated description
                      </Text>
                      <Markdown>{s.suggestion.updatedText}</Markdown>
                    </Box>
                  )}
                  <Flex direction="column" gap="3">
                    <ExperimentChips
                      label="New supporting experiments"
                      experimentIds={s.suggestion.newSupportingExperimentIds}
                      experimentMap={experimentMap}
                    />
                    <ExperimentChips
                      label="New contradicting experiments"
                      experimentIds={s.suggestion.newContradictingExperimentIds}
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
        {suggestions.length > 0 && (
          <Button
            variant="solid"
            disabled={selectedCount === 0 || applying}
            onClick={applySelected}
          >
            {applying
              ? "Applying..."
              : selectedCount === suggestions.length
                ? "Update all"
                : `Update ${selectedCount}`}
          </Button>
        )}
      </Modal.Footer>
    </Modal.Root>
  );
};

export default RefreshLearningsModal;
