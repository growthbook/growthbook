import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  validateFeatureValue,
  getReviewSetting,
  filterEnvironmentsByFeature,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDownFill, PiPlus, PiTrash } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue, useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "./FeatureValueField";

export interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

type FormValues = {
  // Override env id → value. A key's presence means an override exists (even
  // while its value is still being typed). Absence means the env inherits the
  // base default value.
  environmentDefaults: Record<string, string>;
};

// Combined editor for a feature's per-environment default value overrides,
// modeled on ConstantValueModal. The base default value itself is edited by the
// separate EditDefaultValueModal — here we only manage the per-env overrides,
// showing the base value read-only at the top for context (so the user sees
// what inheriting envs resolve to).
//
// Persists through a draft revision, mirroring EditDefaultValueModal. On submit
// the COMPLETE desired override map is sent (full-map-replace): removed rows are
// simply absent, an empty map clears all overrides.
export default function EditEnvironmentDefaultValuesModal({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const allEnvironments = useEnvironments();
  const baseDefaultValue = getFeatureDefaultValue(feature);

  // Only offer environments allowed by the feature's project scoping (same
  // filter the rest of the feature UI uses).
  const allowedEnvironments = useMemo(
    () => filterEnvironmentsByFeature(allEnvironments, feature),
    [allEnvironments, feature],
  );

  const form = useForm<FormValues>({
    defaultValues: {
      environmentDefaults: {},
    },
  });

  // Seed the form from the feature's current per-env overrides.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const seed: Record<string, string> = {};
    for (const [env, s] of Object.entries(feature.environmentSettings ?? {})) {
      if (s?.defaultValue !== undefined) {
        seed[env] = s.defaultValue;
      }
    }
    form.setValue("environmentDefaults", seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature]);

  const envValues = form.watch("environmentDefaults") || {};

  // Rules/values gating: env filtering without kill-switch-specific checks.
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // URL version drives draft behavior: feature.version = new draft, draft version = modify existing.
  const targetVersion =
    mode === "existing" && selectedDraft !== null
      ? selectedDraft
      : feature.version;

  // Show override rows only for allowed envs (in env order); offer the rest in
  // the "add" dropdown.
  const overrideEnvIds = allowedEnvironments
    .map((e) => e.id)
    .filter((id) => id in envValues);
  const addableEnvs = allowedEnvironments.filter((e) => !(e.id in envValues));

  const addOverride = (envId: string) => {
    form.setValue("environmentDefaults", {
      ...form.getValues("environmentDefaults"),
      // Seed a new override with the base default value as a convenient
      // starting point.
      [envId]: baseDefaultValue,
    });
  };
  const removeOverride = (envId: string) => {
    const next = { ...form.getValues("environmentDefaults") };
    delete next[envId];
    form.setValue("environmentDefaults", next);
  };
  const setOverrideValue = (envId: string, v: string) => {
    form.setValue("environmentDefaults", {
      ...form.getValues("environmentDefaults"),
      [envId]: v,
    });
  };

  return (
    <ModalStandard
      trackingEventModalType="edit-environment-default-values"
      header="Edit Per-Environment Default Values"
      cta="Save to draft"
      submit={form.handleSubmit(async (values) => {
        // Build the complete desired override map (full-map-replace). Validate
        // and normalize each value; if validation rewrote a value, surface it
        // for re-submit (same pattern as EditDefaultValueModal).
        const environmentDefaults: Record<string, string> = {};
        let fixed = false;
        for (const [envId, raw] of Object.entries(values.environmentDefaults)) {
          const normalized = validateFeatureValue(feature, raw ?? "", "");
          if (normalized !== raw) {
            fixed = true;
          }
          environmentDefaults[envId] = normalized;
        }
        if (fixed) {
          form.setValue("environmentDefaults", environmentDefaults);
          throw new Error(
            "We fixed some errors in the value. If it looks correct, submit again.",
          );
        }

        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/environmentdefault`,
          {
            method: "POST",
            body: JSON.stringify({ environmentDefaults }),
          },
        );
        await mutate();
        setVersion(res?.version ?? targetVersion);
      })}
      close={close}
      open={true}
      size="lg"
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={false}
        gatedEnvSet={gatedEnvSet}
      />

      <Box mb="5">
        <Text as="div" weight="semibold" mb="1">
          Base default value
        </Text>
        <Text as="p" color="text-low" size="small" mb="1">
          Environments without an override below inherit this value.
        </Text>
        <ForceSummary value={baseDefaultValue} feature={feature} />
      </Box>

      {allowedEnvironments.length > 0 && (
        <Box mb="3">
          <Flex align="center" justify="between" mb="4">
            <Text as="div" weight="semibold">
              Per-environment overrides
            </Text>
            {addableEnvs.length > 0 && (
              <DropdownMenu
                menuPlacement="end"
                variant="soft"
                trigger={
                  <Button variant="outline" size="sm">
                    <Flex align="center" gap="1">
                      <PiPlus /> Add override <PiCaretDownFill size={10} />
                    </Flex>
                  </Button>
                }
              >
                {addableEnvs.map((e) => (
                  <DropdownMenuItem
                    key={e.id}
                    onClick={() => addOverride(e.id)}
                  >
                    {e.id}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}
          </Flex>
          {overrideEnvIds.length === 0 ? (
            <Text as="div" size="small" color="text-mid">
              No overrides yet.
            </Text>
          ) : (
            overrideEnvIds.map((envId) => (
              <Box key={envId} mb="4">
                <Flex align="center" justify="between" mb="1">
                  <Text weight="medium">{envId}</Text>
                  <IconButton
                    variant="ghost"
                    color="red"
                    size="2"
                    radius="full"
                    onClick={() => removeOverride(envId)}
                    aria-label={`Remove ${envId} override`}
                  >
                    <PiTrash size={16} />
                  </IconButton>
                </Flex>
                <FeatureValueField
                  id={`environment-default-${envId}`}
                  value={envValues[envId] || ""}
                  setValue={(v) => setOverrideValue(envId, v)}
                  valueType={feature.valueType}
                  feature={feature}
                  renderJSONInline={true}
                  useCodeInput={true}
                  showFullscreenButton={true}
                />
              </Box>
            ))
          )}
        </Box>
      )}
    </ModalStandard>
  );
}
