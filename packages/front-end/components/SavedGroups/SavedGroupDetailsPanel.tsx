import { Separator } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import DetailsPanel, { PanelSection } from "@/components/DetailsPanel";
import {
  HiddenProject,
  MarkdownValue,
  OwnerField,
  PanelEditButton,
  PanelText,
} from "@/components/DetailsPanelFields";
import RevisionPanelSection from "@/components/Revision/RevisionPanelSection";
import ReferencesPanelSection, {
  PanelReferenceRow,
} from "@/components/References/ReferencesPanelSection";
import { SAVED_GROUP_TYPE_LABELS } from "@/components/SavedGroups/SavedGroupForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import Metadata from "@/ui/Metadata";

export default function SavedGroupDetailsPanel({
  savedGroup,
  onEditInfo,
  editInfoBlockedReason,
  references,
  revision,
  allRevisions,
  isLive,
  requiresApproval,
  canEditRevision,
  onRenameRevision,
  onDescribeRevision,
}: {
  // As viewed: the selected revision's changes over live.
  savedGroup: SavedGroupInterface;
  // Opens the info form; none while the viewer can't edit.
  onEditInfo: (() => void) | null;
  editInfoBlockedReason: string | null;
  references: PanelReferenceRow[];
  // The viewed revision, or live's.
  revision: Revision | null;
  allRevisions: Revision[];
  isLive: boolean;
  requiresApproval: boolean;
  canEditRevision: boolean;
  onRenameRevision: (title: string) => Promise<void>;
  onDescribeRevision: (description: string) => Promise<void>;
}) {
  const { projects: allProjects, getProjectById } = useDefinitions();
  const projects = savedGroup.projects ?? [];
  const pencil = (label: string) =>
    onEditInfo ? (
      <PanelEditButton
        label={label}
        onClick={onEditInfo}
        blockedReason={editInfoBlockedReason}
      />
    ) : null;

  return (
    <DetailsPanel>
      <PanelSection title="General">
        <Metadata
          size="sm"
          stacked
          label="Type"
          value={
            <PanelText>{SAVED_GROUP_TYPE_LABELS[savedGroup.type]}</PanelText>
          }
        />
        {savedGroup.type !== "condition" ? (
          <Metadata
            size="sm"
            stacked
            label="Attribute Key"
            value={<PanelText>{savedGroup.attributeKey}</PanelText>}
          />
        ) : null}
        <Metadata
          size="sm"
          stacked
          label="Description"
          action={pencil("Edit description")}
          value={<MarkdownValue markdown={savedGroup.description} />}
        />
        <OwnerField owner={savedGroup.owner} action={pencil("Edit owner")} />
        {allProjects.length > 0 || projects.length > 0 ? (
          <Metadata
            size="sm"
            stacked
            label="Projects"
            action={pencil("Edit Projects")}
            value={
              projects.length ? (
                <PanelText>
                  {projects.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      {getProjectById(id)?.name || <HiddenProject id={id} />}
                    </span>
                  ))}
                </PanelText>
              ) : (
                <PanelText>All Projects</PanelText>
              )
            }
          />
        ) : null}
      </PanelSection>
      <ReferencesPanelSection
        title="References"
        intro="This Saved Group is referenced by the following:"
        rows={references}
      />
      {revision ? (
        <>
          <Separator size="4" />
          <RevisionPanelSection
            revision={revision}
            allRevisions={allRevisions}
            isLive={isLive}
            requiresApproval={requiresApproval}
            canEdit={canEditRevision}
            onRename={onRenameRevision}
            onDescribe={onDescribeRevision}
          />
        </>
      ) : null}
    </DetailsPanel>
  );
}
