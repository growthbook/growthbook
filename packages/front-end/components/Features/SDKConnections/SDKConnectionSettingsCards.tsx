import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import { ReactNode, useId, useState } from "react";
import { PiCaretRight } from "react-icons/pi";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { isCloud } from "@/services/env";
import { useCustomFields } from "@/hooks/useCustomFields";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  DeliveryMode,
  deliveryModeFromConnection,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  SAVED_GROUP_FORMAT_LABELS,
  SETTING_TITLES,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

const STREAMING_TOOLTIP =
  "Streaming Updates allow you to instantly update any subscribed SDKs when you make any feature changes in GrowthBook. For front-end SDKs, active users will see the changes immediately without having to refresh the page.";

function deliveryModeLabel(mode: DeliveryMode): string {
  if (mode === "remote") return "Remote evaluation";
  if (mode === "ciphered") return "Ciphered";
  return "Plain text";
}

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

function SettingRow({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  tooltip?: string;
}) {
  return (
    <Flex justify="between" align="start" gap="4">
      <Flex align="center" gap="1">
        <Text weight="medium" color="text-high">
          {label}
        </Text>
        {tooltip ? <Tooltip body={tooltip} /> : null}
      </Flex>
      <Box flexShrink="0" style={{ whiteSpace: "nowrap" }}>
        {typeof value === "string" ? (
          <Text weight="regular" color="text-mid">
            {value}
          </Text>
        ) : (
          value
        )}
      </Box>
    </Flex>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Heading size="sm" as="h3" mb="4">
        {title}
      </Heading>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Box>
  );
}

export default function SDKConnectionSettingsCards({
  connection,
  canUpdate,
  onEdit,
}: {
  connection: SDKConnectionInterface;
  canUpdate?: boolean;
  onEdit?: () => void;
}) {
  const customFields = useCustomFields();
  const [open, setOpen] = useState(false);
  const bodyId = useId();

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

  const streamingEnabled = isCloud() || !!connection.proxy?.enabled;

  const selectedCustomFields = (connection.allowedCustomFieldsInMetadata ?? [])
    .map((id) => (customFields || []).find((cf) => cf.id === id)?.name ?? id)
    .filter(Boolean);

  const savedGroupFormat = savedGroupFormatFromConnection(connection);
  const showVisualEditorChip =
    showVisualEditor && !!connection.includeVisualExperiments;

  const summary = [
    payloadSecurityAllowed
      ? deliveryModeLabel(deliveryModeFromConnection(connection))
      : null,
    payloadSecurityAllowed && connection.hashSecureAttributes
      ? "Hashing on"
      : null,
    streamingEnabled ? "Streaming on" : "Streaming off",
    showVisualEditorChip ? "Visual Editor on" : null,
    showSavedGroups && savedGroupFormat !== "inline"
      ? `Saved groups: ${SAVED_GROUP_FORMAT_LABELS[savedGroupFormat]}`
      : null,
    connection.includeRuleIds ? "Rule IDs on" : null,
  ].filter((label): label is string => label !== null);

  return (
    <Frame mb="0" px="0" py="0">
      <Flex align="center" gap="3" pr="6">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((o) => !o)}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-4) 0 var(--space-4) var(--space-6)",
            border: 0,
            background: "transparent",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <PiCaretRight
            aria-hidden
            style={{
              flexShrink: 0,
              color: "var(--gray-11)",
              transform: open ? "rotate(90deg)" : undefined,
              transition: "transform 150ms ease",
            }}
          />
          <Text size="xl" weight="semibold" color="text-high">
            Settings
          </Text>
          <Flex gap="2" wrap="wrap" ml="2">
            {summary.map((label, i) => (
              <Badge
                key={label}
                label={label}
                size="sm"
                radius="full"
                color={i === 0 && payloadSecurityAllowed ? "violet" : "gray"}
              />
            ))}
          </Flex>
        </button>
        {canUpdate && onEdit ? (
          <Link onClick={onEdit} style={{ flexShrink: 0 }}>
            Edit settings
          </Link>
        ) : null}
      </Flex>
      {open ? (
        <Box
          id={bodyId}
          px="6"
          py="5"
          style={{ borderTop: "1px solid var(--gray-a4)" }}
        >
          <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="6">
            <SettingsGroup title={CATEGORY_TITLES.payloadSecurity}>
              {payloadSecurityAllowed && (
                <SettingRow
                  label="Evaluation mode"
                  value={
                    connection.remoteEvalEnabled ? "Remote Eval" : "Standard"
                  }
                />
              )}
              <SettingRow
                label="Streaming updates"
                value={<Toggle on={streamingEnabled} />}
                tooltip={STREAMING_TOOLTIP}
              />
              {payloadSecurityAllowed && (
                <>
                  <SettingRow
                    label="Payload security"
                    value={
                      connection.encryptPayload ||
                      connection.hashSecureAttributes
                        ? "Ciphered"
                        : "Plain text"
                    }
                  />
                  <SettingRow
                    label="Secure attribute hashing"
                    value={<Toggle on={!!connection.hashSecureAttributes} />}
                  />
                </>
              )}
            </SettingsGroup>

            <SettingsGroup title={CATEGORY_TITLES.experiments}>
              {showVisualEditor && (
                <SettingRow
                  label={SETTING_TITLES.visualEditor}
                  value={<Toggle on={!!connection.includeVisualExperiments} />}
                />
              )}
              {showRedirects && (
                <SettingRow
                  label={SETTING_TITLES.urlRedirect}
                  value={
                    <Toggle on={!!connection.includeRedirectExperiments} />
                  }
                />
              )}
              <SettingRow
                label={SETTING_TITLES.hideNames}
                value={
                  <Toggle on={!(connection.includeExperimentNames ?? true)} />
                }
              />
            </SettingsGroup>

            {showSavedGroups && (
              <SettingsGroup title={CATEGORY_TITLES.savedGroups}>
                <SettingRow
                  label={SETTING_TITLES.savedGroupReferences}
                  value={SAVED_GROUP_FORMAT_LABELS[savedGroupFormat]}
                />
              </SettingsGroup>
            )}

            <SettingsGroup title={CATEGORY_TITLES.payloadMetadata}>
              <SettingRow
                label={SETTING_TITLES.projectIds}
                value={<Toggle on={!!connection.includeProjectIdInMetadata} />}
              />
              <SettingRow
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
              <SettingRow
                label={SETTING_TITLES.tags}
                value={<Toggle on={!!connection.includeTagsInMetadata} />}
              />
              <SettingRow
                label={SETTING_TITLES.scheduleDates}
                value={
                  <Toggle
                    on={!!connection.includeExperimentScheduleInMetadata}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup title={CATEGORY_TITLES.observability}>
              <SettingRow
                label={SETTING_TITLES.ruleIds}
                value={<Toggle on={!!connection.includeRuleIds} />}
              />
              <SettingRow
                label={SETTING_TITLES.draftRules}
                value={<Toggle on={!!connection.includeDraftExperimentRefs} />}
              />
              {(showVisualEditor || showRedirects) && (
                <SettingRow
                  label={SETTING_TITLES.draftExperiments}
                  value={<Toggle on={!!connection.includeDraftExperiments} />}
                />
              )}
            </SettingsGroup>

            {/* Self-hosted configures the proxy via env vars. */}
            {isCloud() && (
              <SettingsGroup title={CATEGORY_TITLES.proxy}>
                <SettingRow
                  label={SETTING_TITLES.useProxy}
                  value={<Toggle on={!!connection.proxy?.enabled} />}
                />
                {connection.proxy?.enabled && connection.proxy?.host ? (
                  <SettingRow
                    label={SETTING_TITLES.proxyHost}
                    value={connection.proxy.host}
                  />
                ) : null}
              </SettingsGroup>
            )}
          </Grid>
        </Box>
      ) : null}
    </Frame>
  );
}
