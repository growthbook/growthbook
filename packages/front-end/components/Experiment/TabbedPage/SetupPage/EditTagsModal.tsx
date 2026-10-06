import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import TagsInput from "@/components/Tags/TagsInput";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

// Edits only the experiment's tags, from the Setup page's rail. Same
// TagsInput as EditExperimentInfoModal, so both behave identically.
//
// With onApply (a draft experiment, set in review), Apply hands the tags to
// the Setup page's draft, starting from `initial` (the draft's), and the
// save bar saves them. Without it, Apply saves them straight away.
export default function EditTagsModal({
  experiment,
  close,
  mutate,
  initial: initialTags,
  onApply,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
  initial?: string[];
  onApply?: (tags: string[]) => void;
}) {
  const { apiCall } = useAuth();
  const initial = initialTags ?? experiment.tags ?? [];
  const [tags, setTags] = useState<string[]>(initial);
  // Order-independent: the same tags in a different order aren't a change.
  const changed =
    tags.length !== initial.length || tags.some((t) => !initial.includes(t));

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Tags"
      cta="Apply"
      ctaEnabled={changed}
      trackingEventModalType="edit-experiment-tags"
      trackingEventModalSource="experiment-setup-rail"
      submit={async () => {
        if (onApply) {
          onApply(tags);
          return;
        }
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ tags }),
        });
        mutate();
      }}
    >
      <Box mb="2">
        <Text weight="semibold">Tags</Text>
      </Box>
      <TagsInput autoFocus value={tags} onChange={setTags} />
    </ModalStandard>
  );
}
