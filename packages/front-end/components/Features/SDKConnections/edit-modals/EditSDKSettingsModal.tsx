import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { useId, useState } from "react";
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
import {
  CustomFieldsLabel,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
  RULE_IDS_LABEL,
  SavedGroupReferencesLabel,
  ScheduleDatesLabel,
  TagsLabel,
  UrlRedirectLabel,
  USE_PROXY_LABEL,
  VisualEditorLabel,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
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
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");
  const proxyHostId = useId();

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
            includeExperimentNames: security.includeExperimentNames,
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
          // Premium, as in the full form: without the entitlement this must
          // not be persisted.
          savedGroupReferencesEnabled:
            showSavedGroupSettings &&
            hasLargeSavedGroupFeature &&
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
              {/* Self-hosted configures the proxy via env vars, so the full
                  form only offers these on Cloud. */}
              <Switch
                label={USE_PROXY_LABEL}
                value={proxyEnabled}
                onChange={setProxyEnabled}
              />
              {proxyEnabled && (
                <TextField
                  id={proxyHostId}
                  type="url"
                  placeholder="https://"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  label={
                    <Text as="label" htmlFor={proxyHostId} weight="semibold">
                      Proxy Host URL{" "}
                      <Text size="sm" weight="regular" color="text-mid">
                        (optional)
                      </Text>{" "}
                      <ProxyHostTooltip />
                    </Text>
                  }
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
              {showVisualEditorSettings && (
                <Checkbox
                  weight="regular"
                  label={<VisualEditorLabel />}
                  value={includeVisualExperiments}
                  setValue={setIncludeVisualExperiments}
                />
              )}
              {showRedirectSettings && (
                <Checkbox
                  weight="regular"
                  label={<UrlRedirectLabel />}
                  value={includeRedirectExperiments}
                  setValue={setIncludeRedirectExperiments}
                />
              )}
              <Checkbox
                weight="regular"
                label={<HideNamesLabel />}
                value={!security.includeExperimentNames}
                setValue={(v) =>
                  setSecurity((s) => ({ ...s, includeExperimentNames: !v }))
                }
              />
              <Checkbox
                weight="regular"
                label={RULE_IDS_LABEL}
                value={includeRuleIds}
                setValue={setIncludeRuleIds}
              />
              <Checkbox
                weight="regular"
                label={<DraftRulesLabel />}
                value={includeDraftExperimentRefs}
                setValue={setIncludeDraftExperimentRefs}
              />
              {(showVisualEditorSettings || showRedirectSettings) && (
                <Checkbox
                  weight="regular"
                  label={<DraftExperimentsLabel />}
                  value={includeDraftExperiments}
                  setValue={setIncludeDraftExperiments}
                />
              )}
              <Checkbox
                weight="regular"
                label={<ScheduleDatesLabel />}
                value={includeExperimentScheduleInMetadata}
                setValue={setIncludeExperimentScheduleInMetadata}
              />
            </Flex>
          </Box>
        )}

        {section === "metadata" && (
          <Box>
            <GroupLabel>Payload &amp; Metadata</GroupLabel>
            <Flex direction="column" gap="3">
              <Checkbox
                weight="regular"
                label={<ProjectIdsLabel />}
                value={includeProjectIdInMetadata}
                setValue={setIncludeProjectIdInMetadata}
              />
              <Checkbox
                weight="regular"
                label={<TagsLabel />}
                value={includeTagsInMetadata}
                setValue={setIncludeTagsInMetadata}
              />
              {showSavedGroupSettings && (
                <Checkbox
                  weight="regular"
                  label={
                    <SavedGroupReferencesLabel
                      remoteEvalEnabled={!!connection.remoteEvalEnabled}
                    />
                  }
                  value={savedGroupReferencesEnabled}
                  disabled={!hasLargeSavedGroupFeature}
                  setValue={setSavedGroupReferencesEnabled}
                />
              )}
              <Switch
                label={<CustomFieldsLabel />}
                value={includeCustomFieldsInMetadata}
                onChange={(v) => {
                  setIncludeCustomFieldsInMetadata(v);
                  if (!v) setAllowedCustomFieldsInMetadata([]);
                }}
              />
              {includeCustomFieldsInMetadata && (
                <MultiSelectField
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
