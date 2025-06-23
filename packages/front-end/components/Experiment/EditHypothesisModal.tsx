import { useForm } from "react-hook-form";
import { Box, Flex, Heading, Text, Tooltip } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { useState } from "react";
import { PiArrowClockwise, PiClipboard, PiTrash } from "react-icons/pi";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import Button from "@/components/Radix/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import Markdown from "@/components/Markdown/Markdown";
import Checkbox from "@/components/Radix/Checkbox";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import OptInModal from "@/components/License/OptInModal";
import { AppFeatures } from "@/types/app-features";
import { AISuggestionData, computeAIUsageData } from "@/services/utils";
import track from "@/services/track";
import Field from "../Forms/Field";
import Modal from "../Modal";

interface Props {
  source: string;
  close: () => void;
  experimentId: string;
  initialValue?: string;
  mutate: () => void;
}

export default function EditHypothesisModal({
  source,
  close,
  experimentId,
  initialValue,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const growthbook = useGrowthBook<AppFeatures>();

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiAgreementModal, setAiAgreementModal] = useState<boolean>(false);
  const [aiSuggestionData, setAiSuggestionData] = useState<AISuggestionData>(
    {}
  );
  const form = useForm<{ hypothesis: string; useThisHypothesis: boolean }>({
    defaultValues: {
      hypothesis: initialValue || "",
      useThisHypothesis: false,
    },
  });

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const checkHypothesis = async () => {
    if (!aiAgreedTo) {
      setAiAgreementModal(true);
    } else {
      if (aiEnabled) {
        setError(null);
        setLoading(true);
        const temperature = growthbook.getFeatureValue(
          "ai-suggestions-temperature",
          0.1
        );
        apiCall(
          `/ai/reformat`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "experiment-hypothesis",
              text: form.watch("hypothesis"),
              temperature,
            }),
          },
          (responseData) => {
            if (responseData.status === 429) {
              const retryAfter = parseInt(responseData.retryAfter);
              const hours = Math.floor(retryAfter / 3600);
              const minutes = Math.floor((retryAfter % 3600) / 60);
              setError(
                `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`
              );
            } else {
              setError("Error getting AI suggestion");
            }
            setLoading(false);
          }
        )
          .then((res: { data: { output: string } }) => {
            setAiResponse(res.data.output);
            setAiSuggestionData({
              text: res.data.output,
              temperature,
            });
          })
          .catch(() => {
            // Error handling is done by the apiCall errorHandler
          })
          .finally(() => {
            setLoading(false);
          });
      } else {
        setError("AI is disabled for your organization. Adjust in settings.");
      }
    }
  };

  return (
    <>
      <Modal
        trackingEventModalType="edit-hypothesis-modal"
        trackingEventModalSource={source}
        header={"Edit Hypothesis"}
        size="lg"
        open={true}
        close={close}
        submit={form.handleSubmit(async (data) => {
          const hypothesis =
            form.getValues("useThisHypothesis") && aiResponse
              ? aiResponse
              : data.hypothesis;

          await apiCall(`/experiment/${experimentId}`, {
            method: "POST",
            body: JSON.stringify({
              hypothesis,
            }),
          });

          const aiUsageData = computeAIUsageData({
            value: hypothesis,
            aiSuggestionText: aiSuggestionData.text ?? undefined,
            aiSuggestionTemperature: aiSuggestionData.temperature ?? undefined,
          });
          track("experiment-hypothesis-updated", {
            ...aiUsageData,
          });
          mutate();
        })}
        cta="Save"
        ctaEnabled={initialValue !== form.watch("hypothesis")}
      >
        <div style={{ paddingBottom: "4px" }}>
          <Field
            disabled={form.watch("useThisHypothesis")}
            label="Hypothesis"
            textarea
            minRows={3}
            placeholder="e.g Making the signup button bigger will increase clicks and ultimately improve revenue"
            {...form.register("hypothesis")}
            name="hypothesis"
          />
        </div>
        <Box>
          <Flex align="start" justify="start">
            <Tooltip
              content={
                aiEnabled ? (
                  "Check hypothesis against orgniaztion standards."
                ) : (
                  <>
                    Org admins can set hypothesis formatting standards for the
                    organization in <u>General Settings</u>.
                  </>
                )
              }
              side="bottom"
            >
              <Button
                disabled={
                  !aiEnabled ||
                  loading ||
                  form.watch("hypothesis").trim() === ""
                }
                variant="soft"
                onClick={checkHypothesis}
                stopPropagation={true}
              >
                <BsStars /> Check hypothesis
              </Button>
            </Tooltip>
          </Flex>
          {error && (
            <Box my="4">
              <p className="text-danger">{error}</p>
            </Box>
          )}
          {(loading || aiResponse) && (
            <Box my="4">
              <Flex align="center" justify="between" my="4">
                <Heading size="2" weight="medium">
                  Suggested Hypothesis:
                </Heading>
                <Flex gap="2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      form.setValue("hypothesis", "");
                    }}
                  >
                    <PiTrash /> Clear
                  </Button>
                  {copySupported && (
                    <Box style={{ position: "relative" }}>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          performCopy(aiResponse || "");
                        }}
                      >
                        <PiClipboard /> Copy
                      </Button>
                      {copySuccess ? (
                        <SimpleTooltip position="right">
                          Copied to clipboard!
                        </SimpleTooltip>
                      ) : null}
                    </Box>
                  )}
                  <Button variant="ghost" onClick={checkHypothesis}>
                    <PiArrowClockwise /> Try Again
                  </Button>
                </Flex>
              </Flex>
              <Box>
                {loading && (
                  <Text color="gray">
                    <LoadingSpinner /> Loading...
                  </Text>
                )}
                {!loading && aiResponse && (
                  <>
                    <Box className="appbox" p="3" mb="2">
                      <Markdown>
                        {aiResponse || "No suggestion available."}
                      </Markdown>
                    </Box>
                    <Flex justify="start">
                      <Checkbox
                        label="Use this hypothesis"
                        value={!!form.watch("useThisHypothesis")}
                        setValue={(v) => {
                          form.setValue("useThisHypothesis", v === true);
                        }}
                      />
                    </Flex>
                  </>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </Modal>
      {aiAgreementModal && (
        <OptInModal agreement="ai" onClose={() => setAiAgreementModal(false)} />
      )}
    </>
  );
}
