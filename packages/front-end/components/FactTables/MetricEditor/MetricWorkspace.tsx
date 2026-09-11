import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import omit from "lodash/omit";
import { Flex } from "@radix-ui/themes";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  FactTableDefinition,
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
import MetricEditor from "@/components/FactTables/MetricEditor/MetricEditor";
import TemplateFieldMapping from "@/components/FactTables/MetricEditor/TemplateFieldMapping";
import { FactMetricSeed } from "@/components/FactTables/MetricEditor/templateMetric";

type DefaultsContext = Pick<
  Parameters<typeof getDefaultFactMetricProps>[0],
  "datasources" | "project" | "metricDefaults" | "settings" | "initialFactTable"
>;

function buildFormDefaults(
  existing: FactMetricSeed | null,
  ctx: DefaultsContext,
): CreateFactMetricFormProps {
  return {
    ...toFactMetricFormValues(
      getDefaultFactMetricProps({
        ...ctx,
        // FactMetricSeed is deliberately a flat shape (see its own comment) -
        // Partial<FactMetricInterface> distributes over the real discriminated
        // union, which a still-unmapped template can't satisfy (its metricType
        // is real, but its numerator/factTableId isn't yet). The cast is safe:
        // getDefaultFactMetricProps only ever reads fields with `existing?.`,
        // same as this flat shape guarantees.
        existing: (existing ?? undefined) as
          | Partial<FactMetricInterface>
          | undefined,
        // managedBy is a top-level param, not read from `existing` - unlike
        // every other field, FactMetricModal always passes it explicitly
        // (FactMetricModal.tsx: managedBy: existing?.managedBy). Omitting it
        // defaults to "" regardless of the real value, so editing and saving
        // an official metric would silently strip its official status.
        managedBy: existing?.managedBy,
      }),
    ),
    // getDefaultFactMetricProps always returns null here (shared with
    // FactMetricModal, which tracks funnel steps in its own separate state
    // and never reads this field) - overlay the real value for this stack,
    // which puts funnelSettings on the form like every other field.
    funnelSettings: existing?.funnelSettings ?? null,
  };
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
  duplicateFrom,
  initialFactTable,
  isEditing,
  setIsEditing = () => {},
  mutate,
  onSaved,
  onCancel,
  actionsContainer,
}: {
  actionsContainer: HTMLDivElement | null;
  existing: FactMetricInterface | null;
  // Seeds defaults for a brand-new metric (create payload, not update) -
  // distinct from `existing`, which also decides POST vs PUT. Partial since
  // a metric template has no id/owner/tags/etc. of its own yet. When its
  // numerator has no factTableId, it's an incomplete template seed rather
  // than a real duplicate - TemplateFieldMapping completes it before this
  // form ever renders (see needsMapping below).
  duplicateFrom?: FactMetricSeed | null;
  // Pre-selects a fact table for a brand-new metric with no existing/
  // duplicateFrom data of its own to seed from (e.g. "Add Metric" from a
  // fact table's own page) - existing/duplicateFrom's own fact table always
  // wins when either is set.
  initialFactTable?: FactTableDefinition | null;
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

  const defaultsCtx = {
    datasources,
    project,
    metricDefaults,
    settings,
    initialFactTable: initialFactTable ?? undefined,
  };
  const seedSource = existing ?? duplicateFrom ?? null;

  const form = useForm<CreateFactMetricFormProps>({
    defaultValues: buildFormDefaults(seedSource, defaultsCtx),
  });
  const [error, setError] = useState<string | null>(null);
  // Definition-can't-be-represented is a rare edge case (existing metrics
  // with a legacy sketch aggregation, mostly) - true is the correct default
  // for the overwhelmingly common case (a fresh create, or an ordinary
  // existing metric) while MetricEditor's own effect reports the real value.
  const [representable, setRepresentable] = useState(true);
  // A duplicateFrom with a real (non-null - a funnel duplicate's is null,
  // not this) numerator but no factTableId is an incomplete template seed:
  // nothing else ever constructs one - existing is always a real stored
  // metric, and a plain duplicate always copies a real fact table. Captured
  // once at mount, not derived from the form's own live value: a brand-new
  // metric with no seed at all *also* starts with an empty factTableId, so
  // this only means "map first" when there was a seed to begin with.
  const [needsMapping, setNeedsMapping] = useState(
    () => !!duplicateFrom?.numerator && !duplicateFrom.numerator.factTableId,
  );

  function resync(source: FactMetricSeed | null) {
    form.reset(buildFormDefaults(source, defaultsCtx));
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
    resync(seedSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSource, isEditing]);

  async function handleSave() {
    const values = fromFactMetricFormValues(form.getValues());
    // Save calls form.getValues() directly, not a native form submit, so the
    // Name field's `required` attribute (HTML5 constraint validation) never
    // runs - check it explicitly instead.
    if (!values.name.trim()) throw new Error("Name is required");
    const isFunnel = values.metricType === "funnel";
    if (isFunnel) validateFunnelSteps(values.funnelSettings);

    const payload = isFunnel
      ? {
          ...values,
          numerator: null,
          denominator: null,
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
        ? getFactTableById(values.funnelSettings?.steps[0]?.factTableId ?? "")
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
    resync(seedSource);
    setError(null);
    setIsEditing(false);
  }

  // Mirrors FactMetricModal's own early return (fromTemplate && no
  // factTableId -> FieldMappingModal): complete the seed before showing the
  // normal edit form at all. onMapped resyncs the form with the completed
  // seed and drops into the ordinary edit view - no separate page-level
  // "mapped" state needed. duplicateFrom.numerator is re-checked here (not
  // just via needsMapping, a boolean) so TypeScript narrows it to a real,
  // non-null ColumnRef before it's handed to TemplateFieldMapping.
  if (needsMapping && duplicateFrom?.numerator) {
    return (
      <TemplateFieldMapping
        template={{ ...duplicateFrom, numerator: duplicateFrom.numerator }}
        onCancel={handleDiscard}
        onMapped={(mapped) => {
          resync(mapped);
          setNeedsMapping(false);
        }}
      />
    );
  }

  const actions = (
    <Flex gap="2" flexShrink="0">
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
  );

  return (
    <Flex direction="column" gap="3">
      {isEditing && error && <Callout status="error">{error}</Callout>}
      {isEditing && actionsContainer && createPortal(actions, actionsContainer)}
      <MetricEditor
        existingMetric={existing}
        form={form}
        canEdit={isEditing}
        onRepresentableChange={setRepresentable}
      />
    </Flex>
  );
}
