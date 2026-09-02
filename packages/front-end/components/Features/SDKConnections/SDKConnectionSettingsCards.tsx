import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { isCloud } from "@/services/env";
import { useCustomFields } from "@/hooks/useCustomFields";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { shouldShowPayloadSecurity } from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  SDKConnectionSettingsCategory,
  SETTING_TITLES,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

const STREAMING_TOOLTIP =
  "Streaming Updates allow you to instantly update any subscribed SDKs when you make any feature changes in GrowthBook. For front-end SDKs, active users will see the changes immediately without having to refresh the page.";

// On/off value rendered the same way in every card so they read as one set.
function Toggle({ on }: { on: boolean }) {
  return (
    <Flex as="span" align="center" gap="2">
      <Box
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: on ? "var(--blue-11)" : "var(--gray-8)",
          flexShrink: 0,
        }}
      />
      <Text weight="regular" color="text-mid">
        {on ? "On" : "Off"}
      </Text>
    </Flex>
  );
}

function SettingsCard({
  title,
  canUpdate,
  onEdit,
  children,
}: {
  title: string;
  canUpdate?: boolean;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <Frame mb="0">
      <Flex align="center" justify="between" gap="2" mb="4">
        <Heading size="sm" as="h3" mb="0">
          {title}
        </Heading>
        {canUpdate && onEdit ? <Link onClick={onEdit}>Edit</Link> : null}
      </Flex>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Frame>
  );
}

/**
 * One card per settings category, titled and grouped exactly as the full form
 * is. A setting is only listed when the full form would offer it for this
 * connection's SDK language and version.
 */
export default function SDKConnectionSettingsCards({
  connection,
  canUpdate,
  onEditSection,
}: {
  connection: SDKConnectionInterface;
  canUpdate?: boolean;
  onEditSection?: (section: SDKConnectionSettingsCategory) => void;
}) {
  const customFields = useCustomFields();

  // The same gates the full form applies: Visual Editor and URL Redirects on
  // the SDK's latest version, Saved Groups on the pinned one, and no payload
  // security choices at all for Next.js.
  const currentCaps = getConnectionSDKCapabilities(
    connection,
    "min-ver-intersection",
  );
  const latestCaps = getConnectionSDKCapabilities(
    connection,
    "max-ver-intersection",
  );
  const showVisualEditor = latestCaps.includes("visualEditor");
  const showRedirects = latestCaps.includes("redirects");
  const showSavedGroups = currentCaps.includes("savedGroupReferences");
  const payloadSecurityAllowed = shouldShowPayloadSecurity(
    connection.languages,
  );

  // Streaming is derived, not stored: it works on Cloud, or when a proxy is
  // configured to push updates.
  const streamingEnabled = isCloud() || !!connection.proxy?.enabled;

  const selectedCustomFields = (connection.allowedCustomFieldsInMetadata ?? [])
    .map((id) => (customFields || []).find((cf) => cf.id === id)?.name ?? id)
    .filter(Boolean);

  const edit = (section: SDKConnectionSettingsCategory) =>
    onEditSection ? () => onEditSection(section) : undefined;

  return (
    <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
      <SettingsCard
        title={CATEGORY_TITLES.payloadSecurity}
        canUpdate={canUpdate && payloadSecurityAllowed}
        onEdit={edit("payloadSecurity")}
      >
        {payloadSecurityAllowed && (
          <Metadata
            label="Evaluation mode"
            value={connection.remoteEvalEnabled ? "Remote Eval" : "Standard"}
          />
        )}
        <Flex align="center" gap="1">
          <Metadata
            label="Streaming updates"
            value={<Toggle on={streamingEnabled} />}
          />
          <Tooltip body={STREAMING_TOOLTIP} />
        </Flex>
        {payloadSecurityAllowed && (
          <>
            <Metadata
              label="Payload security"
              // Ciphered covers either half, matching the full form — hashing
              // alone still means the payload isn't plain text.
              value={
                connection.encryptPayload || connection.hashSecureAttributes
                  ? "Ciphered"
                  : "Plain text"
              }
            />
            <Metadata
              label="Secure attribute hashing"
              value={<Toggle on={!!connection.hashSecureAttributes} />}
            />
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title={CATEGORY_TITLES.experiments}
        canUpdate={canUpdate}
        onEdit={edit("experiments")}
      >
        {showVisualEditor && (
          <Metadata
            label={SETTING_TITLES.visualEditor}
            value={<Toggle on={!!connection.includeVisualExperiments} />}
          />
        )}
        {showRedirects && (
          <Metadata
            label={SETTING_TITLES.urlRedirect}
            value={<Toggle on={!!connection.includeRedirectExperiments} />}
          />
        )}
        <Metadata
          label={SETTING_TITLES.hideNames}
          value={<Toggle on={!(connection.includeExperimentNames ?? true)} />}
        />
      </SettingsCard>

      {showSavedGroups && (
        <SettingsCard
          title={CATEGORY_TITLES.savedGroups}
          canUpdate={canUpdate}
          onEdit={edit("savedGroups")}
        >
          <Metadata
            label={SETTING_TITLES.savedGroupReferences}
            value={<Toggle on={!!connection.savedGroupReferencesEnabled} />}
          />
        </SettingsCard>
      )}

      <SettingsCard
        title={CATEGORY_TITLES.payloadMetadata}
        canUpdate={canUpdate}
        onEdit={edit("payloadMetadata")}
      >
        <Metadata
          label={SETTING_TITLES.projectIds}
          value={<Toggle on={!!connection.includeProjectIdInMetadata} />}
        />
        <Metadata
          label={SETTING_TITLES.customFields}
          value={
            <Flex as="span" align="center" gap="2" wrap="wrap">
              <Toggle on={!!connection.includeCustomFieldsInMetadata} />
              {connection.includeCustomFieldsInMetadata &&
              selectedCustomFields.length ? (
                <Text weight="regular" color="text-mid">
                  {selectedCustomFields.join(", ")}
                </Text>
              ) : null}
            </Flex>
          }
        />
        <Metadata
          label={SETTING_TITLES.tags}
          value={<Toggle on={!!connection.includeTagsInMetadata} />}
        />
        <Metadata
          label={SETTING_TITLES.scheduleDates}
          value={
            <Toggle on={!!connection.includeExperimentScheduleInMetadata} />
          }
        />
      </SettingsCard>

      <SettingsCard
        title={CATEGORY_TITLES.observability}
        canUpdate={canUpdate}
        onEdit={edit("observability")}
      >
        <Metadata
          label={SETTING_TITLES.ruleIds}
          value={<Toggle on={!!connection.includeRuleIds} />}
        />
        <Metadata
          label={SETTING_TITLES.draftRules}
          value={<Toggle on={!!connection.includeDraftExperimentRefs} />}
        />
        {(showVisualEditor || showRedirects) && (
          <Metadata
            label={SETTING_TITLES.draftExperiments}
            value={<Toggle on={!!connection.includeDraftExperiments} />}
          />
        )}
      </SettingsCard>

      {/* Self-hosted configures the proxy via env vars, so the full form only
          offers these on Cloud. */}
      {isCloud() && (
        <SettingsCard
          title={CATEGORY_TITLES.proxy}
          canUpdate={canUpdate}
          onEdit={edit("proxy")}
        >
          <Metadata
            label={SETTING_TITLES.useProxy}
            value={<Toggle on={!!connection.proxy?.enabled} />}
          />
          {connection.proxy?.enabled && connection.proxy?.host ? (
            <Metadata
              label={SETTING_TITLES.proxyHost}
              value={connection.proxy.host}
            />
          ) : null}
        </SettingsCard>
      )}
    </Grid>
  );
}
