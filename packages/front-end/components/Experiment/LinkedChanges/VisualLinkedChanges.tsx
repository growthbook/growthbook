import track from "@front-end/services/track";
import { VisualChangesetTable } from "@front-end/components/Experiment/VisualChangesetTable";
import LinkedChangesContainer from "@front-end/components/Experiment/LinkedChanges/LinkedChangesContainer";

export default function VisualLinkedChanges({
  setVisualEditorModal,
  visualChangesets,
  experiment,
  mutate,
  canAddChanges,
  canEditVisualChangesets,
}) {
  const visualChangeCount = visualChangesets.length;

  return (
    <LinkedChangesContainer
      type="visual-editor"
      canAddChanges={canAddChanges}
      changeCount={visualChangeCount}
      experimentStatus={experiment.status}
      onAddChange={() => {
        setVisualEditorModal(true);
        track("Open visual editor modal", {
          source: "visual-editor-ui",
          action: "add",
        });
      }}
    >
      <VisualChangesetTable
        experiment={experiment}
        visualChangesets={visualChangesets}
        mutate={mutate}
        canEditVisualChangesets={canEditVisualChangesets}
      />
    </LinkedChangesContainer>
  );
}
