import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import track from "@/services/track";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import LinkedChangesContainer from "@/components/Experiment/LinkedChanges/LinkedChangesContainer";

export default function VisualLinkedChanges({
  setVisualEditorModal,
  visualChangesets,
  experiment,
  mutate,
  canAddChanges,
  canEditVisualChangesets,
  isPublic,
}: {
  setVisualEditorModal?: (b: boolean) => void;
  visualChangesets: VisualChangesetInterface[];
  experiment: ExperimentInterfaceStringDates;
  mutate?: () => void;
  canAddChanges: boolean;
  canEditVisualChangesets: boolean;
  isPublic?: boolean;
}) {
  const visualChangeCount = visualChangesets.length;

  return (
    <LinkedChangesContainer
      type="visual-editor"
      canAddChanges={canAddChanges}
      changeCount={visualChangeCount}
      experimentStatus={experiment.status}
      onAddChange={() => {
        setVisualEditorModal?.(true);
        track("Open visual editor modal", {
          source: "visual-editor-ui",
          action: "add",
        });
      }}
    >
      {!isPublic ? (
        <VisualChangesetTable
          experiment={experiment}
          visualChangesets={visualChangesets}
          mutate={mutate}
          canEditVisualChangesets={canEditVisualChangesets}
        />
      ) : null}
    </LinkedChangesContainer>
  );
}
