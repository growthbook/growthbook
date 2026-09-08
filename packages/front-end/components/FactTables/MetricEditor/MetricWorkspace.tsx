import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
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
  fromFactMetricFormValues,
  getDefaultFactMetricProps,
  toFactMetricFormValues,
} from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import MetricEditor from "@/components/FactTables/MetricEditor/MetricEditor";
import { formTypeFromStored } from "@/components/FactTables/MetricEditor/metricFormTranslation";

type DefaultsContext = Pick<
  Parameters<typeof getDefaultFactMetricProps>[0],
  "datasources" | "project" | "metricDefaults" | "settings"
>;

function buildFormDefaults(
  existing: FactMetricInterface | null,
  ctx: DefaultsContext,
): CreateFactMetricFormProps {
  return toFactMetricFormValues(
    getDefaultFactMetricProps({ ...ctx, existing: existing ?? undefined }),
  );
}

// FunnelStepsInput has no equivalent to these - matches FactMetricModal's
// own funnel submit checks, which have no reset-rule equivalent either.
function validateFunnelSteps(funnelSettings: FunnelSettings | null): void {
  if (!funnelSettings || funnelSettings.steps.length < 2) {
    throw new Error("Funnel metrics require at least 2 steps");
  }
  for (const step of funnelSettings.steps) {
    if (!step.name.trim()) throw new Error("Every funnel step needs a name");
    if (!step.factTableId) {
      throw new Error("Every funnel step needs a Fact Table");
    }
  }
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
  const { datasources, project, getFactTableById, getDatasourceById } =
    useDefinitions();
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

  function resync(source: FactMetricInterface | null) {
    form.reset(buildFormDefaults(source, defaultsCtx));
    setFunnelSettings(source?.funnelSettings ?? null);
  }

  // useForm's defaultValues are only read once, at mount - view mode would
  // otherwise keep showing whatever `existing` looked like when the page
  // first loaded, even after an out-of-band update (e.g. "Convert to
  // Official Metric" on [fmid].tsx, which PUTs and calls mutateDefinitions()
  // without going through this form at all). Re-sync whenever the saved
  // metric changes while not actively editing; skipped while editing so an
  // unrelated mutateDefinitions() elsewhere doesn't clobber in-progress edits.
  useEffect(() => {
    if (isEditing) return;
    resync(existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, isEditing]);

  // Mirrors MetricEditor's own check - the Save button must stay disabled for
  // a definition the editor can't represent (and thus can't render any field
  // to correct), the same way MetricEditor refuses to render an edit control
  // for it.
  const metricType = form.watch("metricType");
  const numerator = form.watch("numerator");
  const denominator = form.watch("denominator");
  const quantileSettings = form.watch("quantileSettings");
  const primaryFactTableId =
    metricType === "funnel"
      ? (funnelSettings?.steps[0]?.factTableId ?? "")
      : numerator.factTableId;
  const representable = formTypeFromStored(
    { metricType, numerator, denominator, quantileSettings },
    getFactTableById(primaryFactTableId),
  ).representable;

  async function handleSave() {
    const values = fromFactMetricFormValues(form.getValues());
    const isFunnel = values.metricType === "funnel";
    if (isFunnel) validateFunnelSteps(funnelSettings);

    const payload = isFunnel
      ? {
          ...values,
          numerator: null,
          denominator: null,
          funnelSettings,
          quantileSettings: null,
          metricAutoSlices: [],
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
      // New metrics have no Projects field of their own yet (matches
      // FactMetricModal's own create payload) - default to the numerator
      // fact table's projects, falling back to the datasource's.
      const primaryFactTable = isFunnel
        ? getFactTableById(funnelSettings?.steps[0]?.factTableId ?? "")
        : getFactTableById(values.numerator.factTableId);
      const datasource = getDatasourceById(values.datasource);
      const createPayload = {
        ...payload,
        projects: primaryFactTable?.projects || datasource?.projects || [],
      } as CreateFactMetricProps;
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
    resync(existing);
    setError(null);
    setIsEditing(false);
  }

  const actionRow = isEditing && (
    <Flex
      justify="between"
      align="center"
      py="3"
      px="4"
      style={{
        background: "var(--color-panel-solid)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Text color="text-mid">
        {existing ? "Editing metric" : "Creating a new metric"}
      </Text>
      <Flex gap="2">
        <Button variant="soft" color="gray" onClick={handleDiscard}>
          {onCancel ? "Cancel" : "Discard"}
        </Button>
        <Button
          onClick={handleSave}
          setError={setError}
          disabled={!representable}
        >
          Save
        </Button>
      </Flex>
    </Flex>
  );

  return (
    <Flex direction="column" gap="3">
      {isEditing && error && <Callout status="error">{error}</Callout>}
      {actionRow}
      <MetricEditor
        form={form}
        canEdit={isEditing}
        funnelSettings={funnelSettings}
        onFunnelSettingsChange={setFunnelSettings}
      />
      {/* Editing a metric definition is a long form (type, definition,
          basics, advanced settings) - repeat just the buttons at the bottom
          so Save/Discard don't scroll out of reach. The error stays above,
          not duplicated here. */}
      {actionRow}
    </Flex>
  );
}
