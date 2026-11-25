import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Markdown from "@/components/Markdown/Markdown";
import Text from "@/ui/Text";
import ExpandableBlock from "@/ui/ExpandableBlock";

type ExperimentType = ExperimentInterfaceStringDates["type"];

export const EXPERIMENT_TEXT_FIELDS = {
  hypothesis: { label: msg`Hypothesis` },
  description: { label: msg`Description` },
};

export type ExperimentTextFieldKey = keyof typeof EXPERIMENT_TEXT_FIELDS;

/** A field's label and placeholder, translated. */
export function useExperimentTextFieldCopy(
  field: ExperimentTextFieldKey,
  type: ExperimentType,
): { label: string; placeholder: string } {
  const { t } = useLingui();
  if (field === "hypothesis") {
    return {
      label: t`Hypothesis`,
      placeholder: t`What do you expect to happen, and why?`,
    };
  }
  return {
    label: t`Description`,
    placeholder:
      type === "holdout"
        ? t`What is this holdout about?`
        : type === "multi-armed-bandit"
          ? t`What is this Bandit about?`
          : t`What is this experiment about?`,
  };
}

/** A saved hypothesis or description, as read rather than edited. */
export default function ExperimentTextValue({
  field,
  value,
  shareUid,
}: {
  field: ExperimentTextFieldKey;
  value: string;
  // Rendered on the experiment's public page.
  shareUid?: string;
}) {
  if (!value) {
    return (
      <Text weight="regular" color="text-mid" size="md" fontStyle="italic">
        {field === "hypothesis" ? (
          <Trans>No hypothesis</Trans>
        ) : (
          <Trans>No description</Trans>
        )}
      </Text>
    );
  }
  const body = (
    <Markdown
      isPublic={!!shareUid}
      shareUid={shareUid}
      shareType={shareUid ? "experiment" : undefined}
    >
      {value}
    </Markdown>
  );
  // Clamped, so a long one doesn't push the rest of the page away.
  return field === "description" ? (
    <ExpandableBlock bleed>{body}</ExpandableBlock>
  ) : (
    body
  );
}
