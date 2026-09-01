import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { shouldShowPayloadSecurity } from "@/components/Features/SDKConnections/sdkConnectionRules";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/ui/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
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
      size="sm"
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
  const { hasCommercialFeature } = useUser();
  // Same entitlement gates the full connection form applies, so a section modal
  // can't enable a paid option the org doesn't have.
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint",
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  // Capability gates, mirroring SDKConnectionForm: an option is only offered
  // when the connection's SDK language/version actually supports it. Without
  // these a section modal can enable something the SDK will ignore.
  const currentSdkCapabilities = getConnectionSDKCapabilities(
    connection,
    "min-ver-intersection",
  );
  // "max-ver-intersection", as the full form uses: Visual Editor and URL
  // Redirects are offered on what the SDK supports at its LATEST version, not
  // the version this connection is pinned to. Using the pinned version hid them
  // for older SDKs and — because submit sanitises against this — silently
  // cleared the stored value on save.
  const latestSdkCapabilities = getConnectionSDKCapabilities(
    connection,
    "max-ver-intersection",
  );
  // Next.js is plain-text only, so it suppresses both secured modes.
  const payloadSecurityAllowed = shouldShowPayloadSecurity(
    connection.languages,
  );
  const showEncryption =
    payloadSecurityAllowed && currentSdkCapabilities.includes("encryption");
  const showRemoteEval =
    payloadSecurityAllowed && currentSdkCapabilities.includes("remoteEval");
  const showSavedGroupSettings = currentSdkCapabilities.includes(
    "savedGroupReferences",
  );
  const showVisualEditorSettings =
    latestSdkCapabilities.includes("visualEditor");
  const showRedirectSettings = latestSdkCapabilities.includes("redirects");
  // Externally managed connections are read-only, as in the full form.
  const isExternallyManaged = !!connection.managedBy?.type;
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
    if (mode === "remote" && !hasRemoteEvaluationFeature) return;
    if (
      mode === "ciphered" &&
      !hasEncryptionFeature &&
      !hasSecureAttributesFeature
    )
      return;
    setDelivery(mode);
    if (mode === "ciphered") {
      // Only turn on the halves the org is entitled to, as the full form does.
      setEncryptPayload(hasEncryptionFeature);
      setHashSecureAttributes(hasSecureAttributesFeature);
      setIncludeExperimentNames(false);
    } else if (mode === "plain") {
      setEncryptPayload(false);
      setHashSecureAttributes(false);
    }
    // Remote Eval leaves encryption alone: the two are independent, and a
    // remote-eval payload can still be encrypted.
  };

  type DeliveryOption = { label: string | JSX.Element; value: DeliveryMode };
  const allDeliveryOptions: DeliveryOption[] = [
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
  // Only offer the modes this SDK supports, as the full form does.
  const deliveryOptions: DeliveryOption[] = allDeliveryOptions.filter(
    (opt) =>
      (opt.value !== "ciphered" || showEncryption) &&
      (opt.value !== "remote" || showRemoteEval),
  );

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-settings"
      open={true}
      close={close}
      header={SECTION_HEADERS[section]}
      size="lg"
      submit={async () => {
        if (section === "connection") {
          await save({
            proxyEnabled,
            proxyHost: proxyEnabled ? proxyHost : "",
          });
          return;
        }
        if (section === "delivery") {
          await save({
            // Plain Text is the only mode that implies no encryption; Remote
            // Eval keeps whatever the connection had.
            encryptPayload: delivery === "plain" ? false : encryptPayload,
            hashSecureAttributes:
              delivery === "plain" ? false : hashSecureAttributes,
            remoteEvalEnabled: showRemoteEval && delivery === "remote",
            includeExperimentNames,
          });
          return;
        }
        if (section === "experiments") {
          // Mirror the full form: never persist an option the SDK can't use,
          // and drop draft experiments when neither parent is on.
          const visual = showVisualEditorSettings && includeVisualExperiments;
          const redirect = showRedirectSettings && includeRedirectExperiments;
          await save({
            includeRuleIds,
            includeVisualExperiments: visual,
            includeRedirectExperiments: redirect,
            includeDraftExperiments:
              visual || redirect ? includeDraftExperiments : false,
            includeDraftExperimentRefs,
            includeExperimentScheduleInMetadata,
          });
          return;
        }
        await save({
          includeTagsInMetadata,
          includeProjectIdInMetadata,
          savedGroupReferencesEnabled:
            showSavedGroupSettings && savedGroupReferencesEnabled,
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
              {/* Self-hosted configures the proxy via env vars, so the full
                  form only offers these on Cloud. */}
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
              <Text size="sm" color="text-mid">
                {DELIVERY_DESCRIPTIONS[delivery]}
              </Text>
            </Box>

            {(delivery === "ciphered" ||
              (delivery === "remote" && showEncryption)) && (
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
                    disabled={!hasEncryptionFeature || isExternallyManaged}
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
                    disabled={
                      !hasSecureAttributesFeature || isExternallyManaged
                    }
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

            {!payloadSecurityAllowed && (
              <Box mt="3">
                <Switch
                  label="Hide experiment and variation names"
                  description="Strip human-readable experiment and variation names from the payload."
                  value={!includeExperimentNames}
                  onChange={(v) => setIncludeExperimentNames(!v)}
                />
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
                <Text size="sm" color="text-mid">
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
              {showVisualEditorSettings && (
                <Switch
                  label="Visual Editor"
                  description="Include visual editor experiments in the SDK payload."
                  value={includeVisualExperiments}
                  onChange={setIncludeVisualExperiments}
                />
              )}
              {showRedirectSettings && (
                <Switch
                  label="URL Redirects"
                  description="Include URL redirect experiments in the SDK payload."
                  value={includeRedirectExperiments}
                  onChange={setIncludeRedirectExperiments}
                />
              )}
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
              {showSavedGroupSettings && (
                <Switch
                  label="Saved Group References"
                  description="Send saved group references instead of inlined values."
                  value={savedGroupReferencesEnabled}
                  onChange={setSavedGroupReferencesEnabled}
                />
              )}
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
