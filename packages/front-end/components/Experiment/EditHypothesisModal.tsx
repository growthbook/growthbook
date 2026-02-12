import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { useState } from "react";
import { PiArrowClockwise } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useAISettings } from "@/hooks/useOrgSettings";
import Markdown from "@/components/Markdown/Markdown";
import LoadingSpinner from "@/components/LoadingSpinner";
import OptInModal from "@/components/License/OptInModal";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

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
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiAgreementModal, setAiAgreementModal] = useState<boolean>(false);
  const [revertValue, setRevertValue] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<boolean>(true);
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const form = useForm<{ hypothesis: string }>({
    defaultValues: {
      hypothesis: initialValue || "",
    },
  });

  const checkHypothesis = async () => {
    if (!aiAgreedTo) {
      setAiAgreementModal(true);
      // This needs a timeout to avoid a flicker if this modal disappears before the AI agreement modal appears.
      setTimeout(() => {
        setShowModal(false);
      }, 0);
    } else {
      if (aiEnabled) {
        setError(null);
        setLoading(true);
        apiCall(
          `/ai/reformat`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "experiment-hypothesis",
              text: form.watch("hypothesis"),
            }),
          },
          (responseData) => {
            if (responseData.status === 429) {
              const retryAfter = parseInt(responseData.retryAfter);
              const hours = Math.floor(retryAfter / 3600);
              const minutes = Math.floor((retryAfter % 3600) / 60);
              setError(
                `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
              );
            } else if (responseData.message) {
              setError(responseData.message);
            } else {
              setError("Error getting AI suggestion");
            }
            setLoading(false);
          },
        )
          .then((res: { data: { output: string } }) => {
            setAiResponse(res.data.output);
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
        open={showModal}
        close={close}
        submit={form.handleSubmit(async (data) => {
          await apiCall(`/experiment/${experimentId}`, {
            method: "POST",
            body: JSON.stringify({
              hypothesis: data.hypothesis,
            }),
          });
          mutate();
        })}
        cta="Save"
        ctaEnabled={initialValue !== form.watch("hypothesis")}
      >
        <div style={{ paddingBottom: "4px" }}>
          <Field
            label="Hypothesis"
            textarea
            minRows={3}
            placeholder="e.g Making the signup button bigger will increase clicks and ultimately improve revenue"
            {...form.register("hypothesis")}
            name="hypothesis"
          />
        </div>
        <Box>
          {!aiResponse && (
            <Flex align="start" justify="start">
              {hasAISuggestions ? (
                <Tooltip
                  body={
                    aiEnabled ? (
                      "Suggest new hypothesis using organization formatting standards"
                    ) : (
                      <>
                        Org admins can set hypothesis formatting standards for
                        the organization in <strong>General Settings</strong>.
                      </>
                    )
                  }
                >
                  <Button
                    disabled={
                      (!aiEnabled && aiAgreedTo) ||
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
              ) : (
                <PremiumTooltip commercialFeature="ai-suggestions">
                  <Button disabled={true} variant="soft">
                    <BsStars /> Check hypothesis
                  </Button>
                </PremiumTooltip>
              )}
            </Flex>
          )}
          {error && (
            <Box my="4">
              <p className="text-danger">{error}</p>
            </Box>
          )}
          {(loading || aiResponse) && (
            <Box my="4">
              <Flex align="center" justify="between" my="4">
                <Heading size="small" as="h3" weight="medium">
                  Suggested Hypothesis:
                </Heading>
                <Flex gap="2">
                  <Button variant="ghost" onClick={checkHypothesis}>
                    <PiArrowClockwise /> Try Again
                  </Button>
                  {aiResponse && form.getValues("hypothesis") != aiResponse && (
                    <Tooltip body="Overwrite content above with suggested content.">
                      <Button
                        variant="soft"
                        onClick={() => {
                          setRevertValue(form.getValues("hypothesis"));
                          form.setValue("hypothesis", aiResponse);
                        }}
                      >
                        Use Suggested
                      </Button>
                    </Tooltip>
                  )}
                  {revertValue &&
                    form.getValues("hypothesis") == aiResponse && (
                      <Tooltip body="Revert to previous content.">
                        <Button
                          variant="soft"
                          onClick={() => {
                            form.setValue("hypothesis", revertValue);
                            setRevertValue(null);
                          }}
                        >
                          Revert
                        </Button>
                      </Tooltip>
                    )}
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
                  </>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </Modal>
      {aiAgreementModal && (
        <OptInModal
          agreement="ai"
          onClose={() => {
            setShowModal(true);
            setAiAgreementModal(false);
          }}
        />
      )}
    </>
  );
}
