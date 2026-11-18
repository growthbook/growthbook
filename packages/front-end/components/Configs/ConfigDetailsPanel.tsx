import { Separator } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import DetailsPanel, { PanelSection } from "@/components/DetailsPanel";
import {
  CopyableKey,
  MarkdownValue,
  OwnerField,
  PanelEditButton,
  ProjectField,
} from "@/components/DetailsPanelFields";
import RevisionPanelSection from "@/components/Revision/RevisionPanelSection";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function ConfigDetailsPanel({
  config,
  parent,
  onEditInfo,
  revision,
  allRevisions,
  isLive,
  requiresApproval,
  canEditRevision,
  onRenameRevision,
  onDescribeRevision,
}: {
  // As viewed: the selected revision's changes over live.
  config: ConfigInterface;
  parent: { key: string; name: string } | null;
  // Opens the info form; none while the viewer can't edit.
  onEditInfo: (() => void) | null;
  // The viewed revision, or live's.
  revision: Revision | null;
  allRevisions: Revision[];
  isLive: boolean;
  requiresApproval: boolean;
  canEditRevision: boolean;
  onRenameRevision: (title: string) => Promise<void>;
  onDescribeRevision: (description: string) => Promise<void>;
}) {
  const pencil = (label: string) =>
    onEditInfo ? <PanelEditButton label={label} onClick={onEditInfo} /> : null;

  return (
    <DetailsPanel>
      <PanelSection title="General">
        <Metadata
          size="sm"
          stacked
          label="Key"
          value={<CopyableKey value={config.key} />}
        />
        <Metadata
          size="sm"
          stacked
          label="Description"
          action={pencil("Edit description")}
          value={<MarkdownValue markdown={config.description} />}
        />
        <OwnerField owner={config.owner} action={pencil("Edit owner")} />
        <ProjectField
          project={config.project}
          action={pencil("Edit project")}
        />
        {parent ? (
          <Metadata
            size="sm"
            stacked
            label="Extends"
            value={
              <Text size="sm">
                <Link href={`/configs/${parent.key}`}>{parent.name}</Link>
              </Text>
            }
          />
        ) : null}
      </PanelSection>
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
