import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import PayloadSecurityField, {
  PayloadSecurityValue,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
import { deliveryModeFromConnection } from "@/components/Features/SDKConnections/sdkConnectionRules";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

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
  const [security, setSecurity] = useState<PayloadSecurityValue>({
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    includeExperimentNames: connection.includeExperimentNames ?? true,
  });

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
          const plain = security.delivery === "plain";
          await save({
            // Plain Text is the only mode that implies no encryption; Remote
            // Eval keeps whatever the connection had.
            encryptPayload: plain ? false : security.encryptPayload,
            hashSecureAttributes: plain ? false : security.hashSecureAttributes,
            // As the full form: never persist Remote Eval the SDK can't run at
            // its latest version, or that the plan doesn't include.
            remoteEvalEnabled:
              security.delivery === "remote" &&
              latestSdkCapabilities.includes("remoteEval") &&
              hasRemoteEvaluationFeature,
            includeExperimentNames: security.includeExperimentNames,
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
                <TextField
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
          <Box>
            <GroupLabel>Delivery &amp; Security</GroupLabel>
            <PayloadSecurityField
              value={security}
              onChange={(patch) => setSecurity((s) => ({ ...s, ...patch }))}
              languages={connection.languages}
              sdkVersion={connection.sdkVersion}
              disabled={isExternallyManaged}
            />
            {canStream && security.delivery !== "ciphered" && (
              <Box mt="3">
                <Text size="sm" color="text-mid">
                  Streaming updates are enabled — feature changes are pushed to
                  subscribed SDKs in real time.
                </Text>
              </Box>
            )}
          </Box>
        )}

        {section === "experiments" && (
          <Box>
            <GroupLabel>Features &amp; Experiments</GroupLabel>
            <Flex direction="column" gap="3">
              <Checkbox
                label="Rule IDs"
                description="Include feature rule IDs in the SDK payload."
                value={includeRuleIds}
                setValue={setIncludeRuleIds}
              />
              {showVisualEditorSettings && (
                <Checkbox
                  label="Visual editor"
                  description="Include visual editor experiments in the SDK payload."
                  value={includeVisualExperiments}
                  setValue={setIncludeVisualExperiments}
                />
              )}
              {showRedirectSettings && (
                <Checkbox
                  label="URL redirects"
                  description="Include URL redirect experiments in the SDK payload."
                  value={includeRedirectExperiments}
                  setValue={setIncludeRedirectExperiments}
                />
              )}
              <Checkbox
                label="Draft experiments"
                description="Include draft Visual Editor and URL Redirect experiments."
                value={includeDraftExperiments}
                setValue={setIncludeDraftExperiments}
              />
              <Checkbox
                label="Draft experiment rules"
                description="Include draft Experiment rules in feature definitions."
                value={includeDraftExperimentRefs}
                setValue={setIncludeDraftExperimentRefs}
              />
              <Checkbox
                label="Experiment schedule dates"
                description="Include experiment schedule dates in the SDK payload."
                value={includeExperimentScheduleInMetadata}
                setValue={setIncludeExperimentScheduleInMetadata}
              />
            </Flex>
          </Box>
        )}

        {section === "metadata" && (
          <Box>
            <GroupLabel>Payload Metadata</GroupLabel>
            <Flex direction="column" gap="3">
              <Checkbox
                label="Tags in metadata"
                description="Include feature tags."
                value={includeTagsInMetadata}
                setValue={setIncludeTagsInMetadata}
              />
              <Checkbox
                label="Project IDs in metadata"
                description="Include project IDs alongside features."
                value={includeProjectIdInMetadata}
                setValue={setIncludeProjectIdInMetadata}
              />
              {showSavedGroupSettings && (
                <Checkbox
                  label="Saved group references"
                  description="Send saved group references instead of inlined values."
                  value={savedGroupReferencesEnabled}
                  setValue={setSavedGroupReferencesEnabled}
                />
              )}
              <Switch
                label="Custom fields"
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
