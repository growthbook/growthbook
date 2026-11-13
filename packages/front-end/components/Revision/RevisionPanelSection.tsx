import { useState } from "react";
import { Revision, getRevisionNumberById } from "shared/enterprise";
import { isActiveDraftStatus } from "shared/validators";
import { PanelSection } from "@/components/DetailsPanel";
import {
  EmptyValue,
  MarkdownValue,
  PanelEditButton,
  PersonValue,
} from "@/components/DetailsPanelFields";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import EditRevisionTitleModal from "@/components/Reviews/EditRevisionTitleModal";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import { revisionModelFacts } from "@/components/Revision/revisionFacts";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";

// The details panel's section on the viewed revision of the generic revision
// model, as the feature page's panel shows its own.
export default function RevisionPanelSection({
  revision,
  allRevisions,
  isLive,
  requiresApproval,
  canEdit,
  onRename,
  onDescribe,
}: {
  revision: Revision;
  allRevisions: Revision[];
  isLive: boolean;
  requiresApproval: boolean;
  // Only a draft's name and description can change.
  canEdit: boolean;
  onRename: (title: string) => Promise<void>;
  onDescribe: (description: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [describing, setDescribing] = useState(false);
  const version = getRevisionNumberById(allRevisions).get(revision.id) ?? 1;
  const editable = canEdit && isActiveDraftStatus(revision.status);

  return (
    <>
      {renaming ? (
        <EditRevisionTitleModal
          initialValue={revision.title ?? ""}
          version={version}
          close={() => setRenaming(false)}
          onSubmit={onRename}
        />
      ) : null}
      {describing ? (
        <EditRevisionDescriptionModal
          initialValue={revision.comment ?? ""}
          close={() => setDescribing(false)}
          onSubmit={onDescribe}
        />
      ) : null}
      <PanelSection
        title={`Revision ${version}`}
        badge={getStatusBadge(
          isLive ? "live" : revision.status,
          requiresApproval,
        )}
      >
        <Metadata
          size="sm"
          stacked
          label="Name"
          action={
            editable ? (
              <PanelEditButton
                label="Rename revision"
                onClick={() => setRenaming(true)}
              />
            ) : null
          }
          value={
            revision.title ? (
              <Text weight="regular" color="text-mid" size="sm">
                {revision.title}
              </Text>
            ) : (
              <EmptyValue />
            )
          }
        />
        <Metadata
          size="sm"
          stacked
          label="Description"
          action={
            editable ? (
              <PanelEditButton
                label="Edit revision description"
                onClick={() => setDescribing(true)}
              />
            ) : null
          }
          value={<MarkdownValue markdown={revision.comment} />}
        />
        {revisionModelFacts(revision, (id) => <PersonValue id={id} />).map(
          ({ label, value }) => (
            <Metadata
              key={label}
              size="sm"
              stacked
              label={label}
              value={value}
            />
          ),
        )}
      </PanelSection>
    </>
  );
}
