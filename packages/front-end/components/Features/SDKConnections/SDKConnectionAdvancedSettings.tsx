import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { PiCaretDown } from "react-icons/pi";
import { SDKLanguage } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import MultiSelectField from "@/ui/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { useCustomFields } from "@/hooks/useCustomFields";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { SDKConnectionAdvancedValue } from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CustomFieldsLabel,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
  SavedGroupReferencesLabel,
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

/**
 * Everything below Payload Security, in the full form's categories with its
 * copy: GrowthBook Proxy stays visible, the rest sits behind an "Advanced
 * settings" disclosure. Shared by the create and edit modals so the two can't
 * drift; the modals own submission and run `sanitizeAdvancedForSave`.
 */
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
  /** Only changes the Saved Groups warning copy, as in the full form. */
  remoteEvalEnabled: boolean;
}) {
  const customFields = useCustomFields();
  const { hasCommercialFeature } = useUser();
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  // Gated exactly as the full form gates them — with no language chosen yet,
  // the capability-dependent options are not offered.
  const currentCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "min-ver-intersection",
  );
  // "max-ver-intersection" matches the full form: these are offered on what
  // the SDK supports at its latest version, not the pinned one.
  const latestCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "max-ver-intersection",
  );
  const showVisualEditor = latestCaps.includes("visualEditor");
  const showRedirects = latestCaps.includes("redirects");
  const showSavedGroups = currentCaps.includes("savedGroupReferences");

  const [open, setOpen] = useState(false);
  const panelId = useId();
  const proxyHostId = useId();
  // Scroll newly-expanded content into view.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [open]);

  const categories = [
    CATEGORY_TITLES.experiments,
    ...(showSavedGroups ? [CATEGORY_TITLES.savedGroups] : []),
    CATEGORY_TITLES.payloadMetadata,
    CATEGORY_TITLES.observability,
  ];

  return (
    <>
      {/* Self-hosted configures the proxy via env vars, so the full form only
          offers these on Cloud. */}
      {isCloud() && (
        <Category title={CATEGORY_TITLES.proxy}>
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
              {showVisualEditor && (
                <Checkbox
                  weight="regular"
                  value={value.includeVisualExperiments}
                  setValue={(v) => onChange({ includeVisualExperiments: v })}
                  label={<VisualEditorLabel />}
                />
              )}
              {showRedirects && (
                <Checkbox
                  weight="regular"
                  value={value.includeRedirectExperiments}
                  setValue={(v) => onChange({ includeRedirectExperiments: v })}
                  label={<UrlRedirectLabel />}
                />
              )}
              <Checkbox
                weight="regular"
                value={!value.includeExperimentNames}
                setValue={(v) => onChange({ includeExperimentNames: !v })}
                label={<HideNamesLabel />}
              />
            </Category>

            {showSavedGroups && (
              <Category title={CATEGORY_TITLES.savedGroups}>
                <Checkbox
                  weight="regular"
                  value={value.savedGroupReferencesEnabled}
                  setValue={(v) => onChange({ savedGroupReferencesEnabled: v })}
                  disabled={!hasLargeSavedGroupFeature}
                  label={
                    <SavedGroupReferencesLabel
                      remoteEvalEnabled={remoteEvalEnabled}
                    />
                  }
                />
              </Category>
            )}

            <Category title={CATEGORY_TITLES.payloadMetadata}>
              <Checkbox
                weight="regular"
                value={value.includeProjectIdInMetadata}
                setValue={(v) => onChange({ includeProjectIdInMetadata: v })}
                label={<ProjectIdsLabel />}
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
                value={value.includeTagsInMetadata}
                setValue={(v) => onChange({ includeTagsInMetadata: v })}
                label={<TagsLabel />}
              />
              <Checkbox
                weight="regular"
                value={value.includeExperimentScheduleInMetadata}
                setValue={(v) =>
                  onChange({ includeExperimentScheduleInMetadata: v })
                }
                label={<ScheduleDatesLabel />}
              />
            </Category>

            <Category title={CATEGORY_TITLES.observability}>
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
                    value={value.includeDraftExperimentRefs}
                    setValue={(v) =>
                      onChange({ includeDraftExperimentRefs: v })
                    }
                    label={<DraftRulesLabel />}
                  />
                  {(showVisualEditor || showRedirects) && (
                    <Checkbox
                      weight="regular"
                      value={value.includeDraftExperiments}
                      setValue={(v) => onChange({ includeDraftExperiments: v })}
                      label={<DraftExperimentsLabel />}
                    />
                  )}
                </Flex>
              </Box>
            </Category>
          </Flex>
        </Box>
      </Box>
    </>
  );
}
