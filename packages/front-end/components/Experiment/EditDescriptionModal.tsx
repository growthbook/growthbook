import { useForm } from "react-hook-form";
import clsx from "clsx";
import { TextArea } from "@radix-ui/themes";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { ExperimentType } from "shared/validators";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import textAreaStyles from "@/components/Comments/PlainCommentBox.module.scss";

interface Props {
  source: string;
  close: () => void;
  experimentId: string;
  experimentType?: ExperimentType;
  initialValue?: string;
  mutate: () => void;
  // Hand the description to the caller instead of saving (set in review, for
  // the Setup page's rail, whose save bar saves it). The button reads
  // "Apply".
  onApply?: (description: string) => void;
  // Just a text area, as the Setup page's Hypothesis field has (set in
  // review, for the rail): no markdown note or editor toolbar.
  plain?: boolean;
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
  onApply,
  plain = false,
}: Props) {
  const { apiCall } = useAuth();
  const form = useForm<{ description: string }>({
    defaultValues: {
      description: initialValue || "",
    },
  });

  return (
    <ModalStandard
      trackingEventModalSource={source}
      trackingEventModalType="edit-experiment-description-modal"
      header="Edit Description"
      subheader={
        plain ? undefined : (
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
        )
      }
      open={true}
      size="lg"
      close={close}
      cta={onApply ? "Apply" : undefined}
      // The rail's text area (set in review): Apply only once the text
      // differs from what it started with, so typing into an empty one or
      // changing an existing one enables it. Spaces at the ends don't count.
      ctaEnabled={
        !plain ||
        (form.watch("description") ?? "").trim() !== (initialValue ?? "").trim()
      }
      submit={form.handleSubmit(async (description) => {
        if (onApply) {
          onApply(description.description);
          return;
        }
        await apiCall(`/experiment/${experimentId}`, {
          method: "POST",
          body: JSON.stringify(description),
        });
        mutate();
        // forces the description box to be "expanded"
        localStorage.removeItem(`collapse-${experimentId}-description`);
      })}
    >
      {plain ? (
        // The Hypothesis field's text area: the comment box's styles, its
        // hover outline, not resizable. 200px tall here (set in review;
        // Hypothesis is 136px).
        <TextArea
          className={clsx(textAreaStyles.textArea, textAreaStyles.hoverOutline)}
          value={form.watch("description")}
          onChange={(e) => form.setValue("description", e.target.value)}
          placeholder={getExperimentDescriptionPlaceholder(experimentType)}
          aria-label="Description"
          autoFocus
          style={{ height: 200, resize: "none" }}
        />
      ) : (
        <MarkdownInput
          value={form.watch("description")}
          setValue={(value) => form.setValue("description", value)}
          placeholder={getExperimentDescriptionPlaceholder(experimentType)}
        />
      )}
    </ModalStandard>
  );
}
