import { ReactNode, useId, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import type { AppFeatures } from "shared/types/app-features";
import { Box, Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import { useCustomFields } from "@/hooks/useCustomFields";
import { isCloud } from "@/services/env";
import AdvancedSection from "@/components/AdvancedSection";
import {
  connectionCapabilities,
  SDKConnectionAdvancedValue,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import SavedGroupFormatField from "@/components/Features/SDKConnections/SavedGroupFormatField";
import {
  CustomFieldsLabel,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
  ScheduleDatesLabel,
  TagsLabel,
  UrlRedirectLabel,
  VisualEditorLabel,
  CATEGORY_TITLES,
  SETTING_TITLES,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

function Category({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Heading as="h4" size="sm" mb="3">
        {title}
      </Heading>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Box>
  );
}

type GroupProps = {
  value: SDKConnectionAdvancedValue;
  onChange: (patch: Partial<SDKConnectionAdvancedValue>) => void;
  disabled?: boolean;
};

function useCapabilities(languages: SDKLanguage[], sdkVersion?: string) {
  const { currentCaps, latestCaps } = connectionCapabilities({
    languages,
    sdkVersion,
  });
  return {
    showVisualEditor: latestCaps.includes("visualEditor"),
    showRedirects: latestCaps.includes("redirects"),
    showSavedGroups: currentCaps.includes("savedGroupReferences"),
  };
}

export function ExperimentSettings({
  value,
  onChange,
  disabled,
  languages,
  sdkVersion,
}: GroupProps & { languages: SDKLanguage[]; sdkVersion?: string }) {
  const { showVisualEditor, showRedirects } = useCapabilities(
    languages,
    sdkVersion,
  );
  return (
    <>
      {showVisualEditor && (
        <Checkbox
          weight="regular"
          disabled={disabled}
          value={value.includeVisualExperiments}
          setValue={(v) => onChange({ includeVisualExperiments: v })}
          label={<VisualEditorLabel />}
        />
      )}
      {showRedirects && (
        <Checkbox
          weight="regular"
          disabled={disabled}
          value={value.includeRedirectExperiments}
          setValue={(v) => onChange({ includeRedirectExperiments: v })}
          label={<UrlRedirectLabel />}
        />
      )}
      <Checkbox
        weight="regular"
        disabled={disabled}
        value={!value.includeExperimentNames}
        setValue={(v) => onChange({ includeExperimentNames: !v })}
        label={<HideNamesLabel />}
      />
    </>
  );
}

export function MetadataSettings({ value, onChange, disabled }: GroupProps) {
  const customFields = useCustomFields();
  return (
    <>
      {/* As a field's label above its control. */}
      <Text as="div" size="md" weight="semibold">
        {SETTING_TITLES.includeMetadata}
      </Text>
      <Checkbox
        weight="regular"
        disabled={disabled}
        value={value.includeProjectIdInMetadata}
        setValue={(v) => onChange({ includeProjectIdInMetadata: v })}
        label={<ProjectIdsLabel />}
      />
      <Box>
        <Checkbox
          weight="regular"
          disabled={disabled}
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
              size="md"
              disabled={disabled}
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
        disabled={disabled}
        value={value.includeTagsInMetadata}
        setValue={(v) => onChange({ includeTagsInMetadata: v })}
        label={<TagsLabel />}
      />
      <Checkbox
        weight="regular"
        disabled={disabled}
        value={value.includeExperimentScheduleInMetadata}
        setValue={(v) => onChange({ includeExperimentScheduleInMetadata: v })}
        label={<ScheduleDatesLabel />}
      />
    </>
  );
}

export function ObservabilitySettings({
  value,
  onChange,
  disabled,
  languages,
  sdkVersion,
}: GroupProps & { languages: SDKLanguage[]; sdkVersion?: string }) {
  const { showVisualEditor, showRedirects } = useCapabilities(
    languages,
    sdkVersion,
  );
  return (
    <>
      <Checkbox
        weight="regular"
        disabled={disabled}
        label={SETTING_TITLES.ruleIds}
        value={value.includeRuleIds}
        setValue={(v) => onChange({ includeRuleIds: v })}
      />
      <Checkbox
        weight="regular"
        disabled={disabled}
        value={value.includeDraftExperimentRefs}
        setValue={(v) => onChange({ includeDraftExperimentRefs: v })}
        label={<DraftRulesLabel />}
      />
      {(showVisualEditor || showRedirects) && (
        <Checkbox
          weight="regular"
          disabled={disabled}
          value={value.includeDraftExperiments}
          setValue={(v) => onChange({ includeDraftExperiments: v })}
          label={<DraftExperimentsLabel />}
        />
      )}
    </>
  );
}

export const TRACES_TITLE = "Accept traces";

// Shown while its flag is on, or wherever traces are already accepted.
export function useShowTraces(
  connection?: Pick<SDKConnectionInterface, "tracesEnabled">,
): boolean {
  return (
    useFeatureIsOn<AppFeatures>("trace-ingest") || !!connection?.tracesEnabled
  );
}

export function TracesSettings({ value, onChange, disabled }: GroupProps) {
  return (
    <Checkbox
      weight="regular"
      disabled={disabled}
      value={value.tracesEnabled}
      setValue={(v) => onChange({ tracesEnabled: v })}
      label={TRACES_TITLE}
      description="Lets OpenTelemetry exporters send traces to GrowthBook with this connection's client key. Client keys aren't secret, so anyone with this one can send traces."
    />
  );
}

// The host is optional, but one that's given must be a URL.
export function proxyHostError({
  proxyEnabled,
  proxyHost,
}: Pick<SDKConnectionAdvancedValue, "proxyEnabled" | "proxyHost">):
  | string
  | null {
  if (!proxyEnabled || !proxyHost) return null;
  try {
    const { protocol } = new URL(proxyHost);
    if (protocol === "http:" || protocol === "https:") return null;
  } catch {
    // Not a URL.
  }
  return "Enter a valid http:// or https:// URL";
}

// Self-hosted configures the proxy via env vars, so this is cloud-only.
export function ProxySettings({ value, onChange, disabled }: GroupProps) {
  const proxyHostId = useId();
  return (
    <>
      <Checkbox
        weight="regular"
        disabled={disabled}
        label={SETTING_TITLES.useProxy}
        value={value.proxyEnabled}
        setValue={(v) => onChange({ proxyEnabled: v })}
      />
      {value.proxyEnabled && (
        <Field
          id={proxyHostId}
          type="url"
          containerStyle={{ marginBottom: 0 }}
          placeholder="https://"
          disabled={disabled}
          value={value.proxyHost}
          onChange={(e) => onChange({ proxyHost: e.target.value })}
          error={proxyHostError(value)}
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
    </>
  );
}

export default function SDKConnectionAdvancedSettings({
  value,
  onChange,
  languages,
  sdkVersion,
  remoteEvalEnabled,
}: {
  value: SDKConnectionAdvancedValue;
  onChange: (patch: Partial<SDKConnectionAdvancedValue>) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  remoteEvalEnabled: boolean;
}) {
  const { showSavedGroups } = useCapabilities(languages, sdkVersion);
  const showTraces = useShowTraces();
  const [open, setOpen] = useState(false);

  return (
    <>
      {isCloud() && (
        <Category title={CATEGORY_TITLES.proxy}>
          <ProxySettings value={value} onChange={onChange} />
        </Category>
      )}

      <AdvancedSection open={open} setOpen={setOpen}>
        <Flex direction="column" gap="5">
          <Category title={CATEGORY_TITLES.experiments}>
            <ExperimentSettings
              value={value}
              onChange={onChange}
              languages={languages}
              sdkVersion={sdkVersion}
            />
          </Category>

          {showSavedGroups && (
            <Category title={CATEGORY_TITLES.savedGroups}>
              <SavedGroupFormatField
                value={value.savedGroupFormat}
                onChange={(savedGroupFormat) => onChange({ savedGroupFormat })}
                languages={languages}
                sdkVersion={sdkVersion}
                remoteEvalEnabled={remoteEvalEnabled}
              />
            </Category>
          )}

          <Category title={CATEGORY_TITLES.payloadMetadata}>
            <MetadataSettings value={value} onChange={onChange} />
          </Category>

          <Category title={CATEGORY_TITLES.observability}>
            <ObservabilitySettings
              value={value}
              onChange={onChange}
              languages={languages}
              sdkVersion={sdkVersion}
            />
          </Category>

          {showTraces && (
            <Category title="Traces">
              <TracesSettings value={value} onChange={onChange} />
            </Category>
          )}
        </Flex>
      </AdvancedSection>
    </>
  );
}
