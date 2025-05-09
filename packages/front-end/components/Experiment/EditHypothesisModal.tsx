import { useForm } from "react-hook-form";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Button from "@/components/Radix/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import Markdown from "@/components/Markdown/Markdown";
import Modal from "../Modal";
import Field from "../Forms/Field";

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
  const { aiEnabled } = useAISettings();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const form = useForm<{ hypothesis: string }>({
    defaultValues: {
      hypothesis: initialValue || "",
    },
  });

  return (
    <Modal
      trackingEventModalType="edit-hypothesis-modal"
      trackingEventModalSource={source}
      header={"Edit Hypothesis"}
      size="lg"
      open={true}
      close={close}
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experimentId}`, {
          method: "POST",
          body: JSON.stringify({ hypothesis: data.hypothesis }),
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
          minRows={1}
          placeholder="e.g Making the signup button bigger will increase clicks and ultimately improve revenue"
          {...form.register("hypothesis")}
          name="hypothesis"
        />
      </div>
      <Box>
        <Flex align="start" justify="end">
          <Button
            disabled={
              !aiEnabled || loading || form.watch("hypothesis").trim() === ""
            }
            variant="ghost"
            onClick={() => {
              if (aiEnabled) {
                setError(null);
                setLoading(true);
                apiCall(`/ai/reformat`, {
                  method: "POST",
                  body: JSON.stringify({
                    type: "experiment-hypothesis",
                    text: form.watch("hypothesis"),
                  }),
                })
                  .then((res: { data: { output: string } }) => {
                    setAiResponse(res.data.output);
                  })
                  .catch(() => {
                    // handle error
                    setError("Error getting AI suggestion");
                    setLoading(false);
                  })
                  .finally(() => {
                    setLoading(false);
                  });
              }
            }}
            stopPropagation={true}
          >
            Check hypothesis <BsStars />
          </Button>
        </Flex>
        {error && (
          <Box my="4">
            <p className="text-danger">{error}</p>
          </Box>
        )}
        {aiResponse && (
          <Box>
            <Heading size="2" weight="medium">
              AI Response:
            </Heading>
            <Box className="appbox" p="3" mb="2">
              <Markdown>{aiResponse}</Markdown>
            </Box>
            <Box>
              <Flex justify="end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    form.setValue("hypothesis", aiResponse);
                    setAiResponse(null);
                  }}
                >
                  Use this hypothesis
                </Button>
              </Flex>
            </Box>
          </Box>
        )}
      </Box>
    </Modal>
  );
}
