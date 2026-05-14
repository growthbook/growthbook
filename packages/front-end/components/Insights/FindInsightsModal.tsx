import { FC, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AiInsightSuggestion } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiSparkleFill } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Modal from "@/ui/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";

type SuggestionState = {
  suggestion: AiInsightSuggestion;
  saved: boolean;
  saving: boolean;
  error?: string;
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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiCall<{
          status: number;
          insights?: AiInsightSuggestion[];
          message?: string;
        }>("/insights/find", {
          method: "POST",
          body: JSON.stringify({
            experimentIds: experiments.map((e) => e.id),
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
  }, [apiCall, experiments]);

  const experimentMap = new Map(experiments.map((e) => [e.id, e]));

  async function saveSuggestion(index: number) {
    const item = suggestions[index];
    if (!item || item.saved || item.saving) return;
    setSuggestions((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, saving: true, error: undefined } : s,
      ),
    );
    try {
      await apiCall("/insights", {
        method: "POST",
        body: JSON.stringify({
          title: item.suggestion.title,
          text: item.suggestion.text,
          tags: item.suggestion.tags || [],
          supportingExperimentIds: item.suggestion.supportingExperimentIds,
          contraryEvidence: item.suggestion.contraryExperimentIds || [],
          projects: saveProjects || [],
        }),
      });
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
                    <Heading as="h4" size="medium">
                      {s.suggestion.title}
                    </Heading>
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
                  {s.suggestion.supportingExperimentIds.length > 0 && (
                    <Box
                      mb={
                        s.suggestion.contraryExperimentIds?.length ? "3" : "0"
                      }
                    >
                      <Box mb="1">
                        <Text
                          size="small"
                          weight="semibold"
                          color="text-mid"
                          as="div"
                        >
                          Supporting experiments (
                          {s.suggestion.supportingExperimentIds.length})
                        </Text>
                      </Box>
                      <Flex gap="2" wrap="wrap">
                        {s.suggestion.supportingExperimentIds.map((id) => {
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
                  {s.suggestion.contraryExperimentIds &&
                    s.suggestion.contraryExperimentIds.length > 0 && (
                      <Box>
                        <Box mb="1">
                          <Text
                            size="small"
                            weight="semibold"
                            color="text-mid"
                            as="div"
                          >
                            Contrary evidence (
                            {s.suggestion.contraryExperimentIds.length})
                          </Text>
                        </Box>
                        <Flex gap="2" wrap="wrap">
                          {s.suggestion.contraryExperimentIds.map((id) => {
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
        <Modal.Close>
          <Button variant="solid" onClick={close}>
            Done
          </Button>
        </Modal.Close>
      </Modal.Footer>
    </Modal.Root>
  );
};

export default FindInsightsModal;
