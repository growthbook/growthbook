import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { isCloud } from "@/services/env";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

type DeliveryMode = "plain" | "ciphered" | "remote";

const DELIVERY_DESCRIPTIONS: Record<DeliveryMode, string> = {
  plain:
    "Full feature definitions are viewable by anyone with the client key. Highly cacheable.",
  ciphered:
    "Payload encrypted (AES) and secure attributes hashed. Adds obfuscation while staying cacheable.",
  remote:
    "Evaluate features server-side; the SDK fetches results only. Best protection, no caching.",
};

function modeFromConnection(c: SDKConnectionInterface): DeliveryMode {
  if (c.remoteEvalEnabled) return "remote";
  if (c.encryptPayload || c.hashSecureAttributes) return "ciphered";
  return "plain";
}

export type SDKConnectionEditSection =
  | "connection"
  | "delivery"
  | "experiments"
  | "metadata";

// Each Edit link on the page opens this modal scoped to its own section, so a
// section only ever saves the fields it shows.
const SECTION_HEADERS: Record<SDKConnectionEditSection, string> = {
  connection: "Edit Connection Details",
  delivery: "Edit Delivery & Security",
  experiments: "Edit Features & Experiments",
  metadata: "Edit Payload & Metadata",
};

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="small"
      weight="semibold"
      color="text-mid"
      textTransform="uppercase"
      as="div"
      mb="2"
    >
      {children}
    </Text>
  );
}

export default function EditSDKSettingsModal({
  connection,
  close,
  mutate,
  section,
  ...revisionProps
}: {
  connection: SDKConnectionInterface;
  close: () => void;
  mutate: () => Promise<unknown> | void;
  section: SDKConnectionEditSection;
} & SdkConnectionRevisionProps) {
  const customFields = useCustomFields();
  const canStream = isCloud() || !!connection.proxy?.enabled;
  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    ...revisionProps,
  });

  // Delivery & Security
  const [delivery, setDelivery] = useState<DeliveryMode>(
    modeFromConnection(connection),
  );
  const [encryptPayload, setEncryptPayload] = useState(
    !!connection.encryptPayload,
  );
  const [hashSecureAttributes, setHashSecureAttributes] = useState(
    !!connection.hashSecureAttributes,
  );
  const [includeExperimentNames, setIncludeExperimentNames] = useState(
    connection.includeExperimentNames ?? true,
  );

  // Features & Experiments
  const [includeRuleIds, setIncludeRuleIds] = useState(
    !!connection.includeRuleIds,
  );
  const [includeVisualExperiments, setIncludeVisualExperiments] = useState(
    !!connection.includeVisualExperiments,
  );
  const [includeRedirectExperiments, setIncludeRedirectExperiments] = useState(
    !!connection.includeRedirectExperiments,
  );
  const [includeDraftExperiments, setIncludeDraftExperiments] = useState(
    !!connection.includeDraftExperiments,
  );
  const [includeDraftExperimentRefs, setIncludeDraftExperimentRefs] = useState(
    !!connection.includeDraftExperimentRefs,
  );
  const [
    includeExperimentScheduleInMetadata,
    setIncludeExperimentScheduleInMetadata,
  ] = useState(!!connection.includeExperimentScheduleInMetadata);

  // Connection details
  const [proxyEnabled, setProxyEnabled] = useState(!!connection.proxy?.enabled);
  const [proxyHost, setProxyHost] = useState(connection.proxy?.host ?? "");

  // Payload Metadata
  const [includeTagsInMetadata, setIncludeTagsInMetadata] = useState(
    !!connection.includeTagsInMetadata,
  );
  const [includeProjectIdInMetadata, setIncludeProjectIdInMetadata] = useState(
    !!connection.includeProjectIdInMetadata,
  );
  const [savedGroupReferencesEnabled, setSavedGroupReferencesEnabled] =
    useState(!!connection.savedGroupReferencesEnabled);
  const [includeCustomFieldsInMetadata, setIncludeCustomFieldsInMetadata] =
    useState(!!connection.includeCustomFieldsInMetadata);
  const [allowedCustomFieldsInMetadata, setAllowedCustomFieldsInMetadata] =
    useState<string[]>(connection.allowedCustomFieldsInMetadata ?? []);

  const handleDeliveryChange = (mode: DeliveryMode) => {
    setDelivery(mode);
    if (mode === "ciphered") {
      setEncryptPayload(true);
      setHashSecureAttributes(true);
      setIncludeExperimentNames(false);
    } else {
      setEncryptPayload(false);
      setHashSecureAttributes(false);
    }
  };

  const deliveryOptions: {
    label: string | JSX.Element;
    value: DeliveryMode;
  }[] = [
    { label: "Plain Text", value: "plain" },
    {
      label: (
        <Flex as="span" align="center" gap="2">
          Ciphered
          <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
        </Flex>
      ),
      value: "ciphered",
    },
    {
      label: (
        <Flex as="span" align="center" gap="2">
          Remote Eval
          <PaidFeatureBadge commercialFeature="remote-evaluation" />
        </Flex>
      ),
      value: "remote",
    },
  ];

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-settings"
      open={true}
      close={close}
      header={SECTION_HEADERS[section]}
      size="lg"
      submit={async () => {
        const isCiphered = delivery === "ciphered";
        if (section === "connection") {
          await save({
            proxyEnabled,
            proxyHost: proxyEnabled ? proxyHost : "",
          });
          return;
        }
        if (section === "delivery") {
          await save({
            encryptPayload: isCiphered && encryptPayload,
            hashSecureAttributes: isCiphered && hashSecureAttributes,
            remoteEvalEnabled: delivery === "remote",
            includeExperimentNames,
          });
          return;
        }
        if (section === "experiments") {
          await save({
            includeRuleIds,
            includeVisualExperiments,
            includeRedirectExperiments,
            includeDraftExperiments,
            includeDraftExperimentRefs,
            includeExperimentScheduleInMetadata,
          });
          return;
        }
        await save({
          includeTagsInMetadata,
          includeProjectIdInMetadata,
          savedGroupReferencesEnabled,
          includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata: includeCustomFieldsInMetadata
            ? allowedCustomFieldsInMetadata
            : [],
        });
      }}
      cta="Save"
    >
      <Flex direction="column" gap="5" style={{ minWidth: 0, width: "100%" }}>
        {draftSelector}

        {section === "connection" && (
          <Box>
            <GroupLabel>Connection Details</GroupLabel>
            <Flex direction="column" gap="3">
              <Switch
                label="Use GrowthBook Proxy"
                description="Route SDK requests through a GrowthBook Proxy instance."
                value={proxyEnabled}
                onChange={setProxyEnabled}
              />
              {proxyEnabled && (
                <Field
                  label="Proxy Host"
                  placeholder="https://"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                />
              )}
            </Flex>
          </Box>
        )}

        {section === "delivery" && (
          /* Delivery & Security */
          <Box>
            <GroupLabel>Delivery &amp; Security</GroupLabel>
            <ButtonSelectField<DeliveryMode>
              label="Payload Security"
              value={delivery}
              setValue={handleDeliveryChange}
              options={deliveryOptions}
            />
            <Box mt="2">
              <Text size="small" color="text-mid">
                {DELIVERY_DESCRIPTIONS[delivery]}
              </Text>
            </Box>

            {delivery === "ciphered" && (
              <Box
                mt="3"
                p="3"
                style={{ background: "var(--gray-a2)", borderRadius: 8 }}
              >
                <Flex direction="column" gap="3">
                  <Switch
                    label={
                      <Flex as="span" align="center" gap="2">
                        Encrypt payload
                        <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
                      </Flex>
                    }
                    description="Encrypt the SDK payload with AES so feature definitions aren't readable by anyone with the client key."
                    value={encryptPayload}
                    onChange={setEncryptPayload}
                  />
                  <Switch
                    label={
                      <Flex as="span" align="center" gap="2">
                        Hash secure attributes
                        <PaidFeatureBadge commercialFeature="hash-secure-attributes" />
                      </Flex>
                    }
                    description="Anonymize secureString targeting attributes via SHA-256 hashing."
                    value={hashSecureAttributes}
                    onChange={setHashSecureAttributes}
                  />
                  <Switch
                    label="Hide experiment and variation names"
                    description="Strip human-readable experiment and variation names from the payload."
                    value={!includeExperimentNames}
                    onChange={(v) => setIncludeExperimentNames(!v)}
                  />
                </Flex>
              </Box>
            )}

            {delivery === "remote" && (
              <Box mt="3">
                <Callout status="info" size="sm">
                  Remote evaluation requires a self-hosted evaluation service
                  such as{" "}
                  <a
                    href="https://github.com/growthbook/growthbook-proxy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GrowthBook Proxy
                  </a>{" "}
                  or a CDN edge worker
                  {isCloud() ? " (required for Cloud accounts)." : "."}
                </Callout>
              </Box>
            )}

            {canStream && delivery !== "ciphered" && (
              <Box mt="2">
                <Text size="small" color="text-mid">
                  Streaming updates are enabled — feature changes are pushed to
                  subscribed SDKs in real time.
                </Text>
              </Box>
            )}
          </Box>
        )}

        {section === "experiments" && (
          /* Features & Experiments */
          <Box>
            <GroupLabel>Features &amp; Experiments</GroupLabel>
            <Flex direction="column" gap="3">
              <Switch
                label="Rule IDs"
                description="Include feature rule IDs in the SDK payload."
                value={includeRuleIds}
                onChange={setIncludeRuleIds}
              />
              <Switch
                label="Visual Editor"
                description="Include visual editor experiments in the SDK payload."
                value={includeVisualExperiments}
                onChange={setIncludeVisualExperiments}
              />
              <Switch
                label="URL Redirects"
                description="Include URL redirect experiments in the SDK payload."
                value={includeRedirectExperiments}
                onChange={setIncludeRedirectExperiments}
              />
              <Switch
                label="Draft Experiments"
                description="Include draft Visual Editor and URL Redirect experiments."
                value={includeDraftExperiments}
                onChange={setIncludeDraftExperiments}
              />
              <Switch
                label="Draft Experiment Rules"
                description="Include draft Experiment rules in feature definitions."
                value={includeDraftExperimentRefs}
                onChange={setIncludeDraftExperimentRefs}
              />
              <Switch
                label="Experiment Schedule Dates"
                description="Include experiment schedule dates in the SDK payload."
                value={includeExperimentScheduleInMetadata}
                onChange={setIncludeExperimentScheduleInMetadata}
              />
            </Flex>
          </Box>
        )}

        {section === "metadata" && (
          /* Payload Metadata */
          <Box>
            <GroupLabel>Payload Metadata</GroupLabel>
            <Flex direction="column" gap="3">
              <Switch
                label="Tags in Metadata"
                description="Include feature tags."
                value={includeTagsInMetadata}
                onChange={setIncludeTagsInMetadata}
              />
              <Switch
                label="Project IDs in Metadata"
                description="Include project IDs alongside features."
                value={includeProjectIdInMetadata}
                onChange={setIncludeProjectIdInMetadata}
              />
              <Switch
                label="Saved Group References"
                description="Send saved group references instead of inlined values."
                value={savedGroupReferencesEnabled}
                onChange={setSavedGroupReferencesEnabled}
              />
              <Switch
                label="Custom Fields"
                description="Include selected custom fields in the payload."
                value={includeCustomFieldsInMetadata}
                onChange={(v) => {
                  setIncludeCustomFieldsInMetadata(v);
                  if (!v) setAllowedCustomFieldsInMetadata([]);
                }}
              />
              {includeCustomFieldsInMetadata && (
                <MultiSelectField
                  label="Allowed custom fields"
                  placeholder="No fields included"
                  value={allowedCustomFieldsInMetadata}
                  onChange={(fields) =>
                    setAllowedCustomFieldsInMetadata(fields as string[])
                  }
                  options={(customFields || []).map((cf) => ({
                    label: cf.name,
                    value: cf.id,
                  }))}
                  sort={false}
                  closeMenuOnSelect={true}
                />
              )}
            </Flex>
          </Box>
        )}
      </Flex>
    </ModalStandard>
  );
}
