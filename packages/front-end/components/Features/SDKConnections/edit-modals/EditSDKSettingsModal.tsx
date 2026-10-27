import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import { useId, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import PayloadSecurityField, {
  PayloadSecurityValue,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
import {
  advancedValueFromConnection,
  deliveryModeFromConnection,
  sanitizeSavedGroupFormat,
  SDKConnectionAdvancedValue,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import SavedGroupFormatField from "@/components/Features/SDKConnections/SavedGroupFormatField";
import {
  CATEGORY_TITLES,
  CustomFieldsLabel,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
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
  section: SDKConnectionEditSection | "all";
} & SdkConnectionRevisionProps) {
  const customFields = useCustomFields();
  const { hasCommercialFeature } = useUser();
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");
  const proxyHostId = useId();

  const currentSdkCapabilities = getConnectionSDKCapabilities(
    connection,
    "min-ver-intersection",
  );
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
  const canStream = isCloud() || !!connection.proxy?.enabled;
  const sections: SDKConnectionEditSection[] = [
    ...(shouldShowPayloadSecurity(connection.languages)
      ? (["payloadSecurity"] as const)
      : []),
    "experiments",
    ...(showSavedGroupSettings ? (["savedGroups"] as const) : []),
    "payloadMetadata",
    "observability",
    // Self-hosted configures the proxy via env vars.
    ...(isCloud() ? (["proxy"] as const) : []),
  ];
  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    ...revisionProps,
  });

  const [value, setValue] = useState<FormValue>(() => ({
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    ...advancedValueFromConnection(connection),
  }));
  const onChange = (patch: Partial<FormValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  const updatesFor = (s: SDKConnectionEditSection): Record<string, unknown> => {
    switch (s) {
      case "payloadSecurity": {
        const plain = value.delivery === "plain";
        return {
          encryptPayload: plain ? false : value.encryptPayload,
          hashSecureAttributes: plain ? false : value.hashSecureAttributes,
          remoteEvalEnabled:
            value.delivery === "remote" &&
            latestSdkCapabilities.includes("remoteEval") &&
            hasRemoteEvaluationFeature,
          includeExperimentNames: value.includeExperimentNames,
        };
      }
      case "experiments": {
        const visual =
          showVisualEditorSettings && value.includeVisualExperiments;
        const redirect =
          showRedirectSettings && value.includeRedirectExperiments;
        return {
          includeVisualExperiments: visual,
          includeRedirectExperiments: redirect,
          includeExperimentNames: value.includeExperimentNames,
          includeDraftExperiments:
            (visual || redirect) && value.includeDraftExperiments,
        };
      }
      case "savedGroups":
        return {
          savedGroupFormat: sanitizeSavedGroupFormat(value.savedGroupFormat, {
            currentCapabilities: currentSdkCapabilities,
          }),
        };
      case "payloadMetadata":
        return {
          includeProjectIdInMetadata: value.includeProjectIdInMetadata,
          includeCustomFieldsInMetadata: value.includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata: value.includeCustomFieldsInMetadata
            ? value.allowedCustomFieldsInMetadata
            : [],
          includeTagsInMetadata: value.includeTagsInMetadata,
          includeExperimentScheduleInMetadata:
            value.includeExperimentScheduleInMetadata,
        };
      case "observability":
        return {
          includeRuleIds: value.includeRuleIds,
          includeDraftExperimentRefs: value.includeDraftExperimentRefs,
          includeDraftExperiments:
            (value.includeVisualExperiments ||
              value.includeRedirectExperiments) &&
            value.includeDraftExperiments,
        };
      case "proxy":
        if (!isCloud()) return {};
        return {
          proxyEnabled: value.proxyEnabled,
          proxyHost: value.proxyHost,
        };
    }
  };

  const submit = async () => {
    if (section !== "all") {
      await save(updatesFor(section));
      return;
    }
    await save({
      ...Object.assign({}, ...sections.map(updatesFor)),
      // Resolve against the experiment toggles saved alongside it.
      includeDraftExperiments:
        updatesFor("experiments").includeDraftExperiments,
    });
  };

  const fields = (s: SDKConnectionEditSection) => (
    <>
      {s === "payloadSecurity" && (
        <>
          <PayloadSecurityField
            value={value}
            onChange={onChange}
            languages={connection.languages}
            sdkVersion={connection.sdkVersion}
            hideLabel
          />
          {canStream && value.delivery !== "ciphered" && (
            <Box mt="3">
              <Text size="sm" color="text-mid">
                Streaming updates are enabled — feature changes are pushed to
                subscribed SDKs in real time.
              </Text>
            </Box>
          )}
        </>
      )}

      {s === "experiments" && (
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

      {s === "savedGroups" &&
        (showSavedGroupSettings ? (
          <SavedGroupFormatField
            value={value.savedGroupFormat}
            onChange={(savedGroupFormat) => onChange({ savedGroupFormat })}
            languages={connection.languages}
            sdkVersion={connection.sdkVersion}
            remoteEvalEnabled={!!connection.remoteEvalEnabled}
            storedFormat={savedGroupFormatFromConnection(connection)}
          />
        ) : (
          <Text size="sm" color="text-mid">
            Not supported by this connection&apos;s SDK version.
          </Text>
        ))}

      {s === "payloadMetadata" && (
        <Flex direction="column" gap="2">
          <Checkbox
            weight="regular"
            label={<ProjectIdsLabel />}
            value={value.includeProjectIdInMetadata}
            setValue={(v) => onChange({ includeProjectIdInMetadata: v })}
          />
          <Box>
            <Checkbox
              weight="regular"
              label={<CustomFieldsLabel />}
              value={value.includeCustomFieldsInMetadata}
              setValue={(v) =>
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
                    onChange({ allowedCustomFieldsInMetadata: fields })
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

      {s === "observability" && (
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
                setValue={(v) => onChange({ includeDraftExperimentRefs: v })}
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

      {s === "proxy" && isCloud() && (
        <Flex direction="column" gap="3">
          <Checkbox
            weight="regular"
            label={SETTING_TITLES.useProxy}
            value={value.proxyEnabled}
            setValue={(v) => onChange({ proxyEnabled: v })}
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
    </>
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={
        section === "all" ? "Edit settings" : `Edit ${CATEGORY_TITLES[section]}`
      }
      size="lg"
      submit={submit}
      cta="Save"
    >
      <Flex direction="column" gap="5" style={{ minWidth: 0, width: "100%" }}>
        {draftSelector}

        {section === "all" ? (
          sections.map((s, i) => (
            <Box key={s}>
              {i > 0 && <Separator size="4" mb="5" />}
              <GroupLabel>{CATEGORY_TITLES[s]}</GroupLabel>
              {fields(s)}
            </Box>
          ))
        ) : (
          <Box>
            <GroupLabel>{CATEGORY_TITLES[section]}</GroupLabel>
            {fields(section)}
          </Box>
        )}
      </Flex>
    </ModalStandard>
  );
}
