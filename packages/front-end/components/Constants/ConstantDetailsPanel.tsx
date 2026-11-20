import { Separator } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import DetailsPanel, { PanelSection } from "@/components/DetailsPanel";
import {
  CopyableKey,
  MarkdownValue,
  OwnerField,
  PanelEditButton,
  PanelText,
  ProjectField,
} from "@/components/DetailsPanelFields";
import RevisionPanelSection from "@/components/Revision/RevisionPanelSection";
import ReferencesPanelSection, {
  PanelReferences,
} from "@/components/References/ReferencesPanelSection";
import Metadata from "@/ui/Metadata";

const CONSTANT_TYPE_LABEL: Record<ConstantInterface["type"], string> = {
  string: "String",
  json: "JSON",
};

export default function ConstantDetailsPanel({
  constant,
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
  constant: ConstantInterface;
  // Opens the info form; none while the viewer can't edit.
  onEditInfo: ((focus?: "description") => void) | null;
  editInfoBlockedReason: string | null;
  references: PanelReferences;
  // The viewed revision, or live's.
  revision: Revision | null;
  allRevisions: Revision[];
  isLive: boolean;
  requiresApproval: boolean;
  canEditRevision: boolean;
  onRenameRevision: (title: string) => Promise<void>;
  onDescribeRevision: (description: string) => Promise<void>;
}) {
  const pencil = (label: string, focus?: "description") =>
    onEditInfo ? (
      <PanelEditButton
        label={label}
        onClick={() => onEditInfo(focus)}
        blockedReason={editInfoBlockedReason}
      />
    ) : null;

  return (
    <DetailsPanel>
      <PanelSection title="General">
        <Metadata
          size="sm"
          stacked
          label="Key"
          value={<CopyableKey value={constant.key} />}
        />
        <Metadata
          size="sm"
          stacked
          label="Description"
          action={pencil("Edit description", "description")}
          value={<MarkdownValue markdown={constant.description} />}
        />
        <OwnerField owner={constant.owner} action={pencil("Edit owner")} />
        <ProjectField
          project={constant.project}
          action={pencil("Edit Project")}
        />
        <Metadata
          size="sm"
          stacked
          label="Type"
          value={<PanelText>{CONSTANT_TYPE_LABEL[constant.type]}</PanelText>}
        />
      </PanelSection>
      <ReferencesPanelSection
        title="References"
        intro="This Constant is referenced by the following:"
        rows={references.rows}
        loading={references.loading}
        error={references.error}
        emptyText="Nothing references this Constant."
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
