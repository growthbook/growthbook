import { SDKConnectionInterface } from "shared/types/sdk-connection";
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

export type SDKConnectionSettingsSection =
  | "delivery"
  | "experiments"
  | "metadata";

const STREAMING_TOOLTIP =
  "Streaming Updates allow you to instantly update any subscribed SDKs when you make any feature changes in GrowthBook. For front-end SDKs, active users will see the changes immediately without having to refresh the page.";

// On/off value rendered the same way in every card so the three read as one set.
function Toggle({ on }: { on: boolean }) {
  return (
    <Flex as="span" align="center" gap="2">
      <Box
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: on ? "var(--teal-11)" : "var(--gray-8)",
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
        <Heading size="small" as="h3" mb="0">
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

export default function SDKConnectionSettingsCards({
  connection,
  canUpdate,
  onEditSection,
}: {
  connection: SDKConnectionInterface;
  canUpdate?: boolean;
  onEditSection?: (section: SDKConnectionSettingsSection) => void;
}) {
  const customFields = useCustomFields();

  // Streaming is derived, not stored: it works on Cloud, or when a proxy is
  // configured to push updates.
  const streamingEnabled = isCloud() || !!connection.proxy?.enabled;

  const selectedCustomFields = (connection.allowedCustomFieldsInMetadata ?? [])
    .map((id) => (customFields || []).find((cf) => cf.id === id)?.name ?? id)
    .filter(Boolean);

  return (
    <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
      <SettingsCard
        title="Delivery & Security"
        canUpdate={canUpdate}
        onEdit={onEditSection ? () => onEditSection("delivery") : undefined}
      >
        <Metadata
          label="Evaluation mode"
          value={connection.remoteEvalEnabled ? "Remote Eval" : "Standard"}
        />
        <Flex align="center" gap="1">
          <Metadata
            label="Streaming updates"
            value={<Toggle on={streamingEnabled} />}
          />
          <Tooltip body={STREAMING_TOOLTIP} />
        </Flex>
        <Metadata
          label="Payload security"
          value={connection.encryptPayload ? "Ciphered" : "Plain text"}
        />
        <Metadata
          label="Secure attribute hashing"
          value={<Toggle on={!!connection.hashSecureAttributes} />}
        />
        <Metadata
          label="GrowthBook Proxy"
          value={<Toggle on={!!connection.proxy?.enabled} />}
        />
      </SettingsCard>

      <SettingsCard
        title="Features & Experiments"
        canUpdate={canUpdate}
        onEdit={onEditSection ? () => onEditSection("experiments") : undefined}
      >
        <Metadata
          label="Rule IDs"
          value={<Toggle on={!!connection.includeRuleIds} />}
        />
        <Metadata
          label="Visual editor"
          value={<Toggle on={!!connection.includeVisualExperiments} />}
        />
        <Metadata
          label="URL redirects"
          value={<Toggle on={!!connection.includeRedirectExperiments} />}
        />
        <Metadata
          label="Draft experiments"
          value={<Toggle on={!!connection.includeDraftExperiments} />}
        />
        <Metadata
          label="Draft experiment rules"
          value={<Toggle on={!!connection.includeDraftExperimentRefs} />}
        />
        <Metadata
          label="Experiment names"
          value={<Toggle on={connection.includeExperimentNames ?? true} />}
        />
        <Metadata
          label="Experiment schedule dates"
          value={
            <Toggle on={!!connection.includeExperimentScheduleInMetadata} />
          }
        />
      </SettingsCard>

      <SettingsCard
        title="Payload & Metadata"
        canUpdate={canUpdate}
        onEdit={onEditSection ? () => onEditSection("metadata") : undefined}
      >
        <Metadata
          label="Tags in metadata"
          value={<Toggle on={!!connection.includeTagsInMetadata} />}
        />
        <Metadata
          label="Project IDs in metadata"
          value={<Toggle on={!!connection.includeProjectIdInMetadata} />}
        />
        <Metadata
          label="Saved group references"
          value={<Toggle on={!!connection.savedGroupReferencesEnabled} />}
        />
        <Metadata
          label="Custom fields"
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
      </SettingsCard>
    </Grid>
  );
}
