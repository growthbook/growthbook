import { Flex, Separator } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import DetailsPanel, {
  DetailsPanelTab,
  PanelSection,
} from "@/components/DetailsPanel";
import {
  HiddenProject,
  PanelEditButton,
  PanelText,
} from "@/components/DetailsPanelFields";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import RevisionPanelSection from "@/components/Revision/RevisionPanelSection";
import { useDefinitions } from "@/services/DefinitionsContext";
import Metadata from "@/ui/Metadata";

export default function SDKConnectionDetailsPanel({
  connection,
  webhookCount,
  onEditWebhooks,
  editWebhooksBlockedReason,
  revision,
  allRevisions,
  isLive,
  requiresApproval,
  canEditRevision,
  onRenameRevision,
  onDescribeRevision,
  tab,
  setTab,
}: {
  // As viewed: the selected revision's changes over live.
  connection: SDKConnectionInterface;
  webhookCount: number;
  // Opens them to edit; none while the viewer can't.
  onEditWebhooks: (() => void) | null;
  // Why they can't be opened just now, as while edits are staged.
  editWebhooksBlockedReason: string | null;
  // The viewed revision, or live's; none before the first revision.
  revision: Revision | null;
  allRevisions: Revision[];
  isLive: boolean;
  requiresApproval: boolean;
  canEditRevision: boolean;
  onRenameRevision: (title: string) => Promise<void>;
  onDescribeRevision: (description: string) => Promise<void>;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
}) {
  const { getProjectById } = useDefinitions();
  const projects = connection.projects;

  return (
    <DetailsPanel tab={tab} setTab={setTab}>
      <PanelSection title="General">
        <Metadata
          size="sm"
          stacked
          label="SDK"
          value={
            <Flex align="center" gap="3" wrap="wrap">
              {connection.languages.map((language) => (
                <SDKLanguageLogo
                  key={language}
                  language={language}
                  showLabel
                  size={14}
                  hideExtra
                  version={
                    connection.languages.length === 1
                      ? connection.sdkVersion
                      : undefined
                  }
                />
              ))}
            </Flex>
          }
        />
        <Metadata
          size="sm"
          stacked
          label="Environment"
          value={<PanelText>{connection.environment}</PanelText>}
        />
        <Metadata
          size="sm"
          stacked
          label="Projects"
          value={
            <PanelText>
              {projects.length
                ? projects.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      {getProjectById(id)?.name || <HiddenProject id={id} />}
                    </span>
                  ))
                : "All Projects"}
            </PanelText>
          }
        />
      </PanelSection>
      <Separator size="4" />
      <PanelSection title="Delivery">
        <Metadata
          size="sm"
          stacked
          label="Webhooks"
          action={
            onEditWebhooks ? (
              <PanelEditButton
                label="Edit webhooks"
                onClick={onEditWebhooks}
                blockedReason={editWebhooksBlockedReason}
              />
            ) : null
          }
          value={
            <PanelText>
              {webhookCount} webhook{webhookCount === 1 ? "" : "s"}
            </PanelText>
          }
        />
        <Metadata
          size="sm"
          stacked
          label="Proxy"
          value={
            <PanelText>
              {connection.proxy.enabled ? "Enabled" : "Disabled"}
            </PanelText>
          }
        />
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
