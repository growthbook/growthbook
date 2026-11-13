import { ReactNode, useState } from "react";
import isEqual from "lodash/isEqual";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import SectionFrame from "@/components/SectionFrame";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import { HiddenProject } from "@/components/DetailsPanelFields";
import SDKConnectionCredentialsCard, {
  configSettingsTitle,
} from "@/components/Features/SDKConnections/SDKConnectionCredentialsCard";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import { SDKConnectionFormValue } from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import { SdkConnectionStagedEdits } from "@/components/Features/SDKConnections/useSdkConnectionStagedEdits";
import { useShowTraces } from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import {
  CONNECTION_ROWS,
  PAYLOAD_ROWS,
  SECURITY_ROWS,
  SettingRow,
  SettingRowContext,
} from "@/components/Features/SDKConnections/sdkConnectionSettingRows";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import useOrgSettings from "@/hooks/useOrgSettings";
import { isCloud } from "@/services/env";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

// A setting, marked when the viewed draft changes it. Its label shares a
// baseline with the first line of what it labels: an option, a field's value.
function Row({
  label,
  changed,
  children,
}: {
  label: string;
  changed: boolean;
  children: ReactNode;
}) {
  return (
    <SetupFieldRow label={label} content="text" changed={changed}>
      <Box minWidth="0">{children}</Box>
    </SetupFieldRow>
  );
}

// Spaced so each setting reads apart from the next.
function SettingRows({ children }: { children: ReactNode }) {
  return (
    <Flex direction="column" gap="3">
      {children}
    </Flex>
  );
}

export default function SDKConnectionOverview({
  connection,
  staged,
  canEdit,
  blockedReason,
  connections,
  mutate,
}: {
  // As viewed: the selected revision's changes over live.
  connection: SDKConnectionInterface;
  // Edits made here, held until the page's save bar writes them.
  staged: SdkConnectionStagedEdits;
  canEdit: boolean;
  // Why editing is unavailable, shown on the disabled controls.
  blockedReason: string | null;
  // Every connection, as the implementation instructions take them.
  connections: SDKConnectionInterface[];
  mutate: () => Promise<unknown>;
}) {
  const { getProjectById } = useDefinitions();
  const customFields = useCustomFields();
  const settings = useOrgSettings();
  const showTraces = useShowTraces(connection);
  const { stage } = staged;
  // Staged edits only show where they can still be saved.
  const shown = canEdit ? staged.shown : staged.saved;
  // Unsaved: what the staged edits change from the viewed draft or live.
  const changed = (...keys: (keyof SDKConnectionFormValue)[]) =>
    keys.some((k) => !isEqual(shown[k], staged.saved[k]));

  const caps = { languages: shown.languages, sdkVersion: shown.sdkVersion };
  const ctx: SettingRowContext = {
    latestCaps: getConnectionSDKCapabilities(caps, "max-ver-intersection"),
    currentCaps: getConnectionSDKCapabilities(caps, "min-ver-intersection"),
    customFieldName: (id) => customFields?.find((f) => f.id === id)?.name ?? id,
    projectName: (id) => getProjectById(id)?.name || <HiddenProject id={id} />,
    showTraces,
    storedSavedGroupFormat: savedGroupFormatFromConnection(connection),
    managedByVercel: connection.managedBy?.type === "vercel",
    requireProjectSelection:
      !!settings.requireProjectForSdkConnections &&
      (connection.projects?.length ?? 0) > 0,
    cloud: isCloud(),
  };
  const [showSnippet, setShowSnippet] = useState(false);

  const rows = (list: SettingRow[]) =>
    list
      .filter((row) => row.shown(shown, ctx))
      .map((row) => (
        <Row
          key={row.key}
          label={row.label}
          changed={changed(...staged.fieldsOf(row))}
        >
          {canEdit ? (
            <Tooltip content={blockedReason} enabled={!!blockedReason}>
              <Box>{row.edit(shown, stage, !!blockedReason, ctx)}</Box>
            </Tooltip>
          ) : (
            row.read(shown, ctx)
          )}
        </Row>
      ));

  // Not every SDK can secure its payload.
  const security = rows(SECURITY_ROWS);

  return (
    <>
      {showSnippet ? (
        <CodeSnippetModal
          quickStart
          close={() => setShowSnippet(false)}
          connections={connections}
          mutateConnections={mutate}
          sdkConnection={connection}
        />
      ) : null}

      <SectionFrame
        title={configSettingsTitle(connection)}
        mb="4"
        actions={
          <Button
            variant="ghost"
            size="md"
            onClick={() => setShowSnippet(true)}
          >
            Code snippet
          </Button>
        }
      >
        <SDKConnectionCredentialsCard
          connection={connection}
          canUpdate={canEdit}
          mutate={mutate}
        />
      </SectionFrame>

      <SectionFrame title="Connection" mt="4">
        <SettingRows>{rows(CONNECTION_ROWS)}</SettingRows>
      </SectionFrame>

      <SectionFrame title="Payload" mt="4">
        <SettingRows>
          {security}
          {security.length ? <Separator size="4" /> : null}
          {rows(PAYLOAD_ROWS)}
        </SettingRows>
      </SectionFrame>
    </>
  );
}
