import { useForm } from "react-hook-form";
import { useState } from "react";
import omit from "lodash/omit";
import { Flex } from "@radix-ui/themes";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  FunnelSettings,
  UpdateFactMetricProps,
} from "shared/types/fact-table";
import {
  CreateFactMetricFormProps,
  getDefaultFactMetricProps,
} from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import MetricEditor from "@/components/FactTables/MetricEditor/MetricEditor";

type DefaultsContext = Pick<
  Parameters<typeof getDefaultFactMetricProps>[0],
  "datasources" | "project" | "metricDefaults" | "settings"
>;

// getDefaultFactMetricProps returns targetMDE/minPercentChange/maxPercentChange
// as raw fractions (0.05), but the form (and AdvancedSettings, built against
// this convention already) edits them as whole percents (5) - matches
// FactMetricModal's own ×100-on-load/÷100-on-submit boundary exactly.
// winRisk/loseRisk are excluded: the new UI never displays them, so they
// pass through unscaled in both directions.
function buildFormDefaults(
  existing: FactMetricInterface | null,
  ctx: DefaultsContext,
): CreateFactMetricFormProps {
  const defaults = getDefaultFactMetricProps({
    ...ctx,
    existing: existing ?? undefined,
  });
  defaults.targetMDE = defaults.targetMDE * 100;
  defaults.minPercentChange = defaults.minPercentChange * 100;
  defaults.maxPercentChange = defaults.maxPercentChange * 100;
  return defaults;
}

// Inverse of buildFormDefaults, plus the submit-time normalization
// FactMetricModal applies that has no reset-rule equivalent yet: resetting
// displayAsPercentage for types that don't use it, and rejecting a capping
// type with no value. (The other checks in FactMetricModal's submit handler
// are already continuously enforced by applyFormType on type switch.)
function buildSavePayload(
  values: CreateFactMetricFormProps,
): CreateFactMetricFormProps {
  const result = { ...values };
  if (result.targetMDE) result.targetMDE = result.targetMDE / 100;
  result.minPercentChange = result.minPercentChange / 100;
  result.maxPercentChange = result.maxPercentChange / 100;

  if (
    result.metricType !== "ratio" &&
    result.metricType !== "dailyParticipation"
  ) {
    result.displayAsPercentage = undefined;
  } else if (
    result.metricType === "dailyParticipation" &&
    result.displayAsPercentage === undefined
  ) {
    result.displayAsPercentage = true;
  }

  if (result.cappingSettings?.type && !result.cappingSettings.value) {
    throw new Error("Capped Value cannot be 0");
  }

  return result;
}

export default function MetricWorkspace({
  existing,
  isEditing,
  setIsEditing = () => {},
  mutate,
  onSaved,
  onCancel,
}: {
  existing: FactMetricInterface | null;
  isEditing: boolean;
  setIsEditing?: (value: boolean) => void;
  mutate: () => void;
  onSaved?: (metric: FactMetricInterface) => void;
  onCancel?: () => void;
}) {
  const { datasources, project } = useDefinitions();
  const { apiCall } = useAuth();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const settings = useOrgSettings();

  const defaultsCtx = { datasources, project, metricDefaults, settings };

  const form = useForm<CreateFactMetricFormProps>({
    defaultValues: buildFormDefaults(existing, defaultsCtx),
  });
  const [funnelSettings, setFunnelSettings] = useState<FunnelSettings | null>(
    existing?.funnelSettings ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const values = buildSavePayload(form.getValues());
    const payload =
      values.metricType === "funnel"
        ? {
            ...values,
            numerator: null,
            denominator: null,
            funnelSettings,
            quantileSettings: null,
          }
        : { ...values, funnelSettings: null };

    if (existing) {
      const updatePayload = omit(payload, [
        "datasource",
      ]) as UpdateFactMetricProps;
      await apiCall(`/fact-metrics/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload),
      });
      mutate();
      setIsEditing(false);
    } else {
      const createPayload = payload as CreateFactMetricProps;
      const res = await apiCall<{ factMetric: FactMetricInterface }>(
        "/fact-metrics",
        {
          method: "POST",
          body: JSON.stringify(createPayload),
        },
      );
      mutate();
      onSaved?.(res.factMetric);
    }
  }

  function handleDiscard() {
    if (onCancel) {
      onCancel();
      return;
    }
    form.reset(buildFormDefaults(existing, defaultsCtx));
    setFunnelSettings(existing?.funnelSettings ?? null);
    setError(null);
    setIsEditing(false);
  }

  return (
    <Flex direction="column" gap="3">
      {isEditing && (
        <Frame>
          {error && (
            <Callout status="error" mb="2">
              {error}
            </Callout>
          )}
          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={handleDiscard}>
              Discard
            </Button>
            <Button onClick={handleSave} setError={setError}>
              Save
            </Button>
          </Flex>
        </Frame>
      )}
      <MetricEditor
        form={form}
        canEdit={isEditing}
        funnelSettings={funnelSettings}
        onFunnelSettingsChange={setFunnelSettings}
      />
    </Flex>
  );
}
