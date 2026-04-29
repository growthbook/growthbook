import { useForm } from "react-hook-form";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { ExperimentType } from "shared/validators";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Text from "@/ui/Text";

interface Props {
  source: string;
  close: () => void;
  experimentId: string;
  experimentType?: ExperimentType;
  initialValue?: string;
  mutate: () => void;
}

function getExperimentTypeName(experimentType: ExperimentType) {
  switch (experimentType) {
    case "standard":
      return "experiment";
    case "holdout":
      return "holdout";
    case "multi-armed-bandit":
      return "bandit";
  }
}

export function getExperimentDescriptionPlaceholder(
  experimentType: ExperimentType,
) {
  const name = getExperimentTypeName(experimentType);
  return `Add context about this ${name} for your team`;
}

export default function EditDescriptionModal({
  source,
  close,
  experimentId,
  initialValue,
  experimentType = "standard",
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const form = useForm<{ description: string }>({
    defaultValues: {
      description: initialValue || "",
    },
  });

  return (
    <DialogLayout
      trackingEventModalSource={source}
      trackingEventModalType="edit-experiment-description-modal"
      header="Edit Description"
      subheader={
        <>
          <Text size="inherit" mr="1">
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
        </>
      }
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
      <MarkdownInput
        value={form.watch("description")}
        setValue={(value) => form.setValue("description", value)}
        placeholder={getExperimentDescriptionPlaceholder(experimentType)}
      />
    </DialogLayout>
  );
}
