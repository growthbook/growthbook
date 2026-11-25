import { Flex, Separator } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import DetailsPanel, { PanelSection } from "@/components/DetailsPanel";
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
}) {
  const { t } = useLingui();
  const { getProjectById } = useDefinitions();
  const projects = connection.projects;

  return (
    <DetailsPanel>
      <PanelSection title={t`General`}>
        <Metadata
          size="sm"
          stacked
          label={t`SDK`}
          value={
            <Flex align="center" gap="3" wrap="wrap">
              {connection.languages.map((language) => (
                <PanelText key={language}>
                  <SDKLanguageLogo
                    language={language}
                    showLabel
                    size={16}
                    hideExtra
                    version={
                      connection.languages.length === 1
                        ? connection.sdkVersion
                        : undefined
                    }
                  />
                </PanelText>
              ))}
            </Flex>
          }
        />
        <Metadata
          size="sm"
          stacked
          label={t`Environment`}
          value={<PanelText>{connection.environment}</PanelText>}
        />
        <Metadata
          size="sm"
          stacked
          label={t`Projects`}
          value={
            <PanelText>
              {projects.length
                ? projects.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      {getProjectById(id)?.name || <HiddenProject id={id} />}
                    </span>
                  ))
                : t`All Projects`}
            </PanelText>
          }
        />
        <Metadata
          size="sm"
          stacked
          label={t`Webhooks`}
          action={
            onEditWebhooks ? (
              <PanelEditButton
                label={t`Edit webhooks`}
                onClick={onEditWebhooks}
                blockedReason={editWebhooksBlockedReason}
              />
            ) : null
          }
          value={
            <PanelText>
              <Plural value={webhookCount} one="# webhook" other="# webhooks" />
            </PanelText>
          }
        />
        {connection.proxy.enabled ? (
          <Metadata
            size="sm"
            stacked
            label={t`Proxy`}
            value={
              <PanelText>
                <Trans>Enabled</Trans>
              </PanelText>
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
