import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { PiCaretDown } from "react-icons/pi";
import { SavedGroupFormat, SDKLanguage } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { useCustomFields } from "@/hooks/useCustomFields";
import { isCloud } from "@/services/env";
import { SDKConnectionAdvancedValue } from "@/components/Features/SDKConnections/sdkConnectionRules";
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
  const currentCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "min-ver-intersection",
  );
  const latestCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "max-ver-intersection",
  );
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
        <TextField
          id={proxyHostId}
          type="url"
          placeholder="https://"
          disabled={disabled}
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
    </>
  );
}

export default function SDKConnectionAdvancedSettings({
  value,
  onChange,
  languages,
  sdkVersion,
  remoteEvalEnabled,
  storedSavedGroupFormat,
}: {
  value: SDKConnectionAdvancedValue;
  onChange: (patch: Partial<SDKConnectionAdvancedValue>) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  remoteEvalEnabled: boolean;
  storedSavedGroupFormat?: SavedGroupFormat;
}) {
  const { showSavedGroups } = useCapabilities(languages, sdkVersion);

  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Scrolls only the modal's scroll viewport: `scrollIntoView` also scrolls the
  // scroll area's clipped root, shifting the viewport and leaving a blank band.
  useEffect(() => {
    const panel = ref.current;
    const viewport = panel?.closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!open || !panel || !viewport) return;
    const p = panel.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    const overflow = p.bottom - v.bottom;
    if (overflow <= 0) return;
    viewport.scrollBy({
      top: Math.min(overflow, p.top - v.top - 8),
      behavior: "smooth",
    });
  }, [open]);

  const categories = [
    CATEGORY_TITLES.experiments,
    ...(showSavedGroups ? [CATEGORY_TITLES.savedGroups] : []),
    CATEGORY_TITLES.payloadMetadata,
    CATEGORY_TITLES.observability,
  ];

  return (
    <>
      {isCloud() && (
        <Category title={CATEGORY_TITLES.proxy}>
          <ProxySettings value={value} onChange={onChange} />
        </Category>
      )}

      <Box
        ref={ref}
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: 8,
          overflow: "hidden",
          scrollMarginTop: 8,
        }}
      >
        <Flex
          align="center"
          justify="between"
          gap="2"
          px="3"
          py="3"
          onClick={() => setOpen((v) => !v)}
          role="button"
          aria-expanded={open}
          aria-controls={panelId}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          style={{
            cursor: "pointer",
            userSelect: "none",
            background: "var(--gray-a2)",
            borderBottom: open ? "1px solid var(--gray-a5)" : undefined,
          }}
        >
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="md" weight="medium">
              Advanced settings
            </Text>
            {!open && (
              <Text size="sm" color="text-mid">
                {categories.join(" · ")}
              </Text>
            )}
          </Flex>
          <PiCaretDown
            size={16}
            style={{
              color: "var(--gray-11)",
              transition: "transform 180ms ease",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          />
        </Flex>
        {/* Kept mounted so the aria-controls target always exists. */}
        <Box id={panelId} p="3" hidden={!open}>
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
                  onChange={(savedGroupFormat) =>
                    onChange({ savedGroupFormat })
                  }
                  languages={languages}
                  sdkVersion={sdkVersion}
                  remoteEvalEnabled={remoteEvalEnabled}
                  storedFormat={storedSavedGroupFormat}
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
          </Flex>
        </Box>
      </Box>
    </>
  );
}
