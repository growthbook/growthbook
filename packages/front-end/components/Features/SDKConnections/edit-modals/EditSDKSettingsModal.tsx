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
import {
  advancedValueFromConnection,
  deliveryModeFromConnection,
  SDKConnectionAdvancedValue,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  CustomFieldsLabel,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
  SavedGroupReferencesLabel,
  ScheduleDatesLabel,
  SDKConnectionSettingsCategory,
  SETTING_TITLES,
  TagsLabel,
  UrlRedirectLabel,
  VisualEditorLabel,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

// Each settings card on the page opens this modal scoped to its own category,
// so a section only ever saves the fields it shows.
export type SDKConnectionEditSection = SDKConnectionSettingsCategory;

type FormValue = PayloadSecurityValue & SDKConnectionAdvancedValue;

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

  // Capability gates, mirroring the full form: an option is only offered when
  // the connection's SDK language/version actually supports it.
  const currentSdkCapabilities = getConnectionSDKCapabilities(
    connection,
    "min-ver-intersection",
  );
  // "max-ver-intersection", as the full form uses: Visual Editor and URL
  // Redirects are offered on what the SDK supports at its LATEST version, not
  // the version this connection is pinned to.
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

  // One state object for every section, so a field is never held twice.
  const [value, setValue] = useState<FormValue>(() => ({
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    ...advancedValueFromConnection(connection),
  }));
  const onChange = (patch: Partial<FormValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  const submit = async () => {
    switch (section) {
      case "payloadSecurity": {
        const plain = value.delivery === "plain";
        await save({
          // Plain Text is the only mode that implies no encryption.
          encryptPayload: plain ? false : value.encryptPayload,
          hashSecureAttributes: plain ? false : value.hashSecureAttributes,
          // As the full form: never persist Remote Eval the SDK can't run at
          // its latest version, or that the plan doesn't include.
          remoteEvalEnabled:
            value.delivery === "remote" &&
            latestSdkCapabilities.includes("remoteEval") &&
            hasRemoteEvaluationFeature,
          includeExperimentNames: value.includeExperimentNames,
        });
        return;
      }
      case "experiments": {
        const visual =
          showVisualEditorSettings && value.includeVisualExperiments;
        const redirect =
          showRedirectSettings && value.includeRedirectExperiments;
        await save({
          includeVisualExperiments: visual,
          includeRedirectExperiments: redirect,
          includeExperimentNames: value.includeExperimentNames,
          // As the full form: draft auto-experiments need a parent option on.
          includeDraftExperiments:
            (visual || redirect) && !!connection.includeDraftExperiments,
        });
        return;
      }
      case "savedGroups":
        await save({
          // Premium, as in the full form: without the entitlement this must
          // not be persisted.
          savedGroupReferencesEnabled:
            showSavedGroupSettings &&
            hasLargeSavedGroupFeature &&
            value.savedGroupReferencesEnabled,
        });
        return;
      case "payloadMetadata":
        await save({
          includeProjectIdInMetadata: value.includeProjectIdInMetadata,
          includeCustomFieldsInMetadata: value.includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata: value.includeCustomFieldsInMetadata
            ? value.allowedCustomFieldsInMetadata
            : [],
          includeTagsInMetadata: value.includeTagsInMetadata,
          includeExperimentScheduleInMetadata:
            value.includeExperimentScheduleInMetadata,
        });
        return;
      case "observability":
        await save({
          includeRuleIds: value.includeRuleIds,
          includeDraftExperimentRefs: value.includeDraftExperimentRefs,
          includeDraftExperiments:
            (!!connection.includeVisualExperiments ||
              !!connection.includeRedirectExperiments) &&
            value.includeDraftExperiments,
        });
        return;
      case "proxy":
        await save({
          proxyEnabled: value.proxyEnabled,
          proxyHost: value.proxyEnabled ? value.proxyHost : "",
        });
        return;
    }
  };

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-settings"
      open={true}
      close={close}
      header={`Edit ${CATEGORY_TITLES[section]}`}
      size="lg"
      submit={submit}
      cta="Save"
    >
      <Flex direction="column" gap="5" style={{ minWidth: 0, width: "100%" }}>
        {draftSelector}

        <Box>
          <GroupLabel>{CATEGORY_TITLES[section]}</GroupLabel>

          {section === "payloadSecurity" && (
            <>
              <PayloadSecurityField
                value={value}
                onChange={onChange}
                languages={connection.languages}
                sdkVersion={connection.sdkVersion}
                disabled={isExternallyManaged}
              />
              {canStream && value.delivery !== "ciphered" && (
                <Box mt="3">
                  <Text size="sm" color="text-mid">
                    Streaming updates are enabled — feature changes are pushed
                    to subscribed SDKs in real time.
                  </Text>
                </Box>
              )}
            </>
          )}

          {section === "experiments" && (
            <Flex direction="column" gap="2">
              {showVisualEditorSettings && (
                <Checkbox
                  weight="regular"
                  label={<VisualEditorLabel />}
                  value={value.includeVisualExperiments}
                  setValue={(v) => onChange({ includeVisualExperiments: v })}
                />
              )}
              {showRedirectSettings && (
                <Checkbox
                  weight="regular"
                  label={<UrlRedirectLabel />}
                  value={value.includeRedirectExperiments}
                  setValue={(v) => onChange({ includeRedirectExperiments: v })}
                />
              )}
              <Checkbox
                weight="regular"
                label={<HideNamesLabel />}
                value={!value.includeExperimentNames}
                setValue={(v) => onChange({ includeExperimentNames: !v })}
              />
            </Flex>
          )}

          {section === "savedGroups" &&
            (showSavedGroupSettings ? (
              <Checkbox
                weight="regular"
                label={
                  <SavedGroupReferencesLabel
                    remoteEvalEnabled={!!connection.remoteEvalEnabled}
                  />
                }
                value={value.savedGroupReferencesEnabled}
                disabled={!hasLargeSavedGroupFeature}
                setValue={(v) => onChange({ savedGroupReferencesEnabled: v })}
              />
            ) : (
              <Text size="sm" color="text-mid">
                Not supported by this connection&apos;s SDK version.
              </Text>
            ))}

          {section === "payloadMetadata" && (
            <Flex direction="column" gap="2">
              <Checkbox
                weight="regular"
                label={<ProjectIdsLabel />}
                value={value.includeProjectIdInMetadata}
                setValue={(v) => onChange({ includeProjectIdInMetadata: v })}
              />
              <Box>
                <Switch
                  label={<CustomFieldsLabel />}
                  value={value.includeCustomFieldsInMetadata}
                  onChange={(v) =>
                    onChange({
                      includeCustomFieldsInMetadata: v,
                      ...(v ? {} : { allowedCustomFieldsInMetadata: [] }),
                    })
                  }
                />
                {value.includeCustomFieldsInMetadata && (
                  <Box mt="2">
                    <MultiSelectField
                      placeholder="No fields included"
                      value={value.allowedCustomFieldsInMetadata}
                      onChange={(fields) =>
                        onChange({
                          allowedCustomFieldsInMetadata: fields as string[],
                        })
                      }
                      options={(customFields || []).map((cf) => ({
                        label: cf.name,
                        value: cf.id,
                      }))}
                      sort={false}
                      closeMenuOnSelect={true}
                    />
                  </Box>
                )}
              </Box>
              <Checkbox
                weight="regular"
                label={<TagsLabel />}
                value={value.includeTagsInMetadata}
                setValue={(v) => onChange({ includeTagsInMetadata: v })}
              />
              <Checkbox
                weight="regular"
                label={<ScheduleDatesLabel />}
                value={value.includeExperimentScheduleInMetadata}
                setValue={(v) =>
                  onChange({ includeExperimentScheduleInMetadata: v })
                }
              />
            </Flex>
          )}

          {section === "observability" && (
            <Flex direction="column" gap="3">
              <Checkbox
                weight="regular"
                label={SETTING_TITLES.ruleIds}
                value={value.includeRuleIds}
                setValue={(v) => onChange({ includeRuleIds: v })}
              />
              <Box>
                <Text as="div" size="md" weight="medium" mb="2">
                  Draft mode experiments
                </Text>
                <Flex direction="column" gap="2">
                  <Checkbox
                    weight="regular"
                    label={<DraftRulesLabel />}
                    value={value.includeDraftExperimentRefs}
                    setValue={(v) =>
                      onChange({ includeDraftExperimentRefs: v })
                    }
                  />
                  {(showVisualEditorSettings || showRedirectSettings) && (
                    <Checkbox
                      weight="regular"
                      label={<DraftExperimentsLabel />}
                      value={value.includeDraftExperiments}
                      setValue={(v) => onChange({ includeDraftExperiments: v })}
                    />
                  )}
                </Flex>
              </Box>
            </Flex>
          )}

          {section === "proxy" && (
            <Flex direction="column" gap="3">
              <Switch
                label={SETTING_TITLES.useProxy}
                value={value.proxyEnabled}
                onChange={(v) => onChange({ proxyEnabled: v })}
              />
              {value.proxyEnabled && (
                <TextField
                  id={proxyHostId}
                  type="url"
                  placeholder="https://"
                  value={value.proxyHost}
                  onChange={(e) => onChange({ proxyHost: e.target.value })}
                  label={
                    <Text as="label" htmlFor={proxyHostId} weight="semibold">
                      {SETTING_TITLES.proxyHost}{" "}
                      <Text size="sm" weight="regular" color="text-mid">
                        (optional)
                      </Text>{" "}
                      <ProxyHostTooltip />
                    </Text>
                  }
                />
              )}
            </Flex>
          )}
        </Box>
      </Flex>
    </ModalStandard>
  );
}
