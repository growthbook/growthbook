import { useForm } from "react-hook-form";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import { upperFirst } from "lodash";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Modal from "@/components/Modal";

interface Props {
  source: string;
  close: () => void;
  experimentId: string;
  experimentType?: string;
  initialValue?: string;
  mutate: () => void;
}

export default function EditDescriptionModal({
  source,
  close,
  experimentId,
  initialValue,
  experimentType = "experiment",
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const form = useForm<{ description: string }>({
    defaultValues: {
      description: initialValue || "",
    },
  });

  return (
    <Modal
      trackingEventModalSource={source}
      trackingEventModalType="edit-experiment-description-modal"
      header="Edit Description"
      open={true}
      size="lg"
      close={close}
      submit={form.handleSubmit(async (description) => {
        await apiCall(`/experiment/${experimentId}`, {
          method: "POST",
          body: JSON.stringify(description),
        });
        mutate();
        // forces the description box to be "expanded"
        localStorage.removeItem(`collapse-${experimentId}-description`);
      })}
    >
      <Flex align="center" wrap="wrap" width="auto" mb="2">
        <Box as="div">
          <Text className="pr-1" as="span">
            Use markdown to format your content.
          </Text>
          <Link
            rel="noreferrer"
            target="_blank"
            weight="bold"
            href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          >
            Learn More
            <PiArrowSquareOutFill className="ml-1" />
          </Link>
        </Box>
      </Flex>
      <MarkdownInput
        value={form.watch("description")}
        setValue={(value) => form.setValue("description", value)}
        placeholder={`Add a description to keep your team informed about the purpose and parameters of your ${upperFirst(
          experimentType || "experiment",
        )}.`}
      />
    </Modal>
  );
}
