import { Fragment, ReactNode, useEffect, useMemo, useRef } from "react";
import { PiInfo } from "react-icons/pi";
import { UseFormReturn, useForm } from "react-hook-form";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { datetime, getValidDate } from "shared/dates";
import {
  DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
  MAX_PRECOMPUTED_UNIT_DIMENSIONS,
} from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  datasourceHasWritableEphemeralPipeline,
  getIsExperimentIncludedInIncrementalRefresh,
} from "@/services/experiments";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricSelector from "@/components/Experiment/MetricSelector";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import MetricAnalysisWindowSelector from "@/components/Experiment/MetricAnalysisWindowSelector";
import MetricsOverridesSelector from "@/components/Experiment/MetricsOverridesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "@/components/Experiment/EditMetricsForm";
import MultiSelectField from "@/ui/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
import TextField from "@/ui/TextField";
import { ValueDot } from "./SetupFunnel";
import styles from "./AnalysisPlan.module.scss";

// The rest of the analysis settings, inline in the Analysis Plan's Advanced
// section: the current phase's start and end time, activation metric, custom metric slices, always-computed unit
// dimensions, segment, metric conversion windows, the metric analysis window
// (attribution model and lookback), custom SQL filter, and metric overrides.
// They used to be reachable only through the analysis settings modal.
//
// PORTED FROM AnalysisForm's metrics section: the same controls, labels,
// help text, conditions, premium gating and save semantics. That includes
// its components, several of which are LEGACY FALLBACKS (components/Forms'
// SelectField and Field, the legacy Tooltip) with no @/ui/ equivalent for
// these patterns. Size props are left at their defaults, since passing
// size="legacy" explicitly is lint-banned in new code.
//
// It keeps its own react-hook-form instance because MetricsOverridesSelector
// can only work against one. The page's single Save and Discard drive it
// through onStateChange; nothing here saves on its own.

const ACTIVATION_METRIC_INFO =
  "Only a single proportion (binomial) metric from the experiment's data source that shares an identifier type with the assignment table, or can be joined to it through a join table.";

const VARIATION_IDS_INFO =
  "Must match the variation_id values in your data source.";

// The Custom SQL Filter's right-hand column ("Available columns"), as an
// empty spacer beside the fields that line up with the filter.
const SQL_FILTER_ASIDE = "col-sm-4 col-lg-6";

// What the page needs to fold these fields into its Save and Discard.
export interface AdvancedAnalysisState {
  dirty: boolean;
  // Only the fields that changed, in the shape AnalysisForm sends.
  getPayload: () => Record<string, unknown>;
  reset: () => void;
}

// The Analysis Plan shows these fields in three of its four groups (set in
// review; the fourth, Statistics, is StatsSettingsFields). The blocks are
// exactly as they were under the old single Advanced section, only sorted;
// the page wraps each group in its disclosure.
export interface AdvancedAnalysisGroups {
  // Exposures (was "Who's in the analysis"): start (and end) time, activation metric,
  // segment, custom SQL filter, variation IDs.
  who: ReactNode;
  // Measurement (was "How metrics are counted"): in-progress conversions, metric window
  // settings, custom metric slices, always-computed unit dimensions.
  counting: ReactNode;
  // Whether those two groups have anything to configure yet (set in
  // review): none of Measurement's settings apply without a data source
  // that supports them or metrics, and there's nothing to override without
  // metrics. The page hides a card with nothing in it.
  hasCounting: boolean;
  hasOverrides: boolean;
  // Metric Overrides (was "Per-metric overrides"): the Metric Overrides block.
  overrides: ReactNode;
}

// The fields this section owns. Goal/secondary/guardrail metrics are
// mirrored in from the page (MetricsOverridesSelector reads them from the
// form) but never saved from here.
const OWNED_FIELDS = [
  "dateStarted",
  "dateEnded",
  "activationMetric",
  "segment",
  "queryFilter",
  "skipPartialData",
  "attributionModel",
  "lookbackOverride",
  "customMetricSlices",
  "precomputedUnitDimensionIds",
  "metricOverrides",
  "variationKeys",
] as const;

export default function AdvancedAnalysisFields({
  experiment,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  editable,
  onStateChange,
  renderGroups,
}: {
  experiment: ExperimentInterfaceStringDates;
  // The page draft's current metric lists, unsaved edits included.
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  editable: boolean;
  onStateChange: (state: AdvancedAnalysisState) => void;
  renderGroups: (groups: AdvancedAnalysisGroups) => ReactNode;
}) {
  const { segments, getDatasourceById, getExperimentMetricById, dimensions } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();

  // Org settings via a ref: useOrgSettings() can return a new object on every
  // render, and seeding from it directly would re-seed (and wipe edits) on
  // every render. The seed only needs its current value when it runs.
  const orgSettingsRef = useRef(orgSettings);
  orgSettingsRef.current = orgSettings;

  // Seeded exactly as AnalysisForm seeds these fields. Re-seeded only when
  // the saved experiment changes; the metric lists are kept in sync
  // separately below.
  const defaults = useMemo(
    () => ({
      // The current phase's actual start and end, NOT the scheduled start
      // (that's Timing's "Starts"). These bound which users results include.
      dateStarted: getValidDate(
        experiment.phases[experiment.phases.length - 1]?.dateStarted ?? "",
      )
        .toISOString()
        .substr(0, 16),
      dateEnded: getValidDate(
        experiment.phases[experiment.phases.length - 1]?.dateEnded ?? "",
      )
        .toISOString()
        .substr(0, 16),
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      skipPartialData: experiment.skipPartialData ? "strict" : "loose",
      attributionModel:
        experiment.attributionModel ||
        orgSettingsRef.current.attributionModel ||
        "firstExposure",
      lookbackOverride: experiment.lookbackOverride
        ? experiment.lookbackOverride.type === "date"
          ? {
              type: "date" as const,
              value: getValidDate(experiment.lookbackOverride.value),
            }
          : {
              ...experiment.lookbackOverride,
              valueUnit:
                experiment.lookbackOverride.valueUnit ??
                DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
            }
        : undefined,
      customMetricSlices: experiment.customMetricSlices || [],
      precomputedUnitDimensionIds: experiment.precomputedUnitDimensionIds || [],
      metricOverrides: getDefaultMetricOverridesFormValue(
        experiment.metricOverrides || [],
        getExperimentMetricById,
        orgSettingsRef.current,
      ),
      // Each variation's key (its "ID", the variation_id value analysis
      // matches on), in order.
      variationKeys: experiment.variations.map((v) => v.key),
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
    }),
    // The metric lists are deliberately not dependencies (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [experiment, getExperimentMetricById],
  );

  const form = useForm({ defaultValues: defaults });

  // The saved experiment moved (a save, or an edit elsewhere): start over
  // from it.
  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  // Keep the mirrored metric lists in step with the page's draft.
  useEffect(() => {
    form.setValue("goalMetrics", goalMetrics);
    form.setValue("secondaryMetrics", secondaryMetrics);
    form.setValue("guardrailMetrics", guardrailMetrics);
  }, [form, goalMetrics, secondaryMetrics, guardrailMetrics]);

  // Report dirtiness and a payload builder to the page on every change.
  const values = form.watch();
  const changed = OWNED_FIELDS.filter(
    (key) => JSON.stringify(values[key]) !== JSON.stringify(defaults[key]),
  );
  const changedKey = changed.join(",");
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current({
      dirty: changed.length > 0,
      getPayload: () => {
        const v = form.getValues();
        const payload: Record<string, unknown> = {};
        for (const key of changed) {
          if (key === "dateStarted") {
            payload.currentPhase = experiment.phases.length - 1;
            payload.phaseStartDate = v.dateStarted;
          } else if (key === "dateEnded") {
            // Only meaningful once stopped, as in AnalysisForm, which only
            // sends an end date for a stopped experiment.
            if (experiment.status !== "stopped") continue;
            payload.currentPhase = experiment.phases.length - 1;
            payload.phaseEndDate = v.dateEnded;
          } else if (key === "skipPartialData") {
            payload.skipPartialData = v.skipPartialData === "strict";
          } else if (key === "variationKeys") {
            // Sent as the experiment's variations with only their keys
            // changed: names, weights and order are untouched.
            payload.variations = experiment.variations.map((variation, i) => ({
              ...variation,
              key: v.variationKeys[i] ?? variation.key,
            }));
          } else if (key === "metricOverrides") {
            const overrides = structuredClone(v.metricOverrides || []);
            fixMetricOverridesBeforeSaving(overrides);
            payload.metricOverrides = overrides;
          } else {
            payload[key] = v[key];
          }
        }
        return payload;
      },
      reset: () => form.reset(defaults),
    });
    // changedKey stands in for `changed`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedKey, defaults, form]);

  // --- Derived, as in AnalysisForm ---
  const datasource = getDatasourceById(experiment.datasource);
  const datasourceProperties = datasource?.properties;
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === datasource?.id,
  );
  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
      experiment.type,
    );
  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");
  const hasPipelineModeFeature = hasCommercialFeature("pipeline-mode");
  const precomputedUnitDimensionOptions = dimensions
    .filter(
      (d) =>
        d.datasource === experiment.datasource &&
        (!exposureQuery || d.userIdType === exposureQuery.userIdType),
    )
    .map((d) => ({ label: d.name, value: d.id }));
  const hasEligiblePrecomputedUnitDimensions =
    precomputedUnitDimensionOptions.length > 0 &&
    datasourceHasWritableEphemeralPipeline(datasource, hasPipelineModeFeature);
  const selectedPrecomputedUnitDimensionIds =
    form.watch("precomputedUnitDimensionIds") || [];
  const precomputedUnitDimensionLimitReached =
    selectedPrecomputedUnitDimensionIds.length >=
    MAX_PRECOMPUTED_UNIT_DIMENSIONS;
  const precomputedUnitDimensionOptionsWithTooltips =
    precomputedUnitDimensionOptions.map((option) => ({
      ...option,
      tooltip:
        precomputedUnitDimensionLimitReached &&
        !selectedPrecomputedUnitDimensionIds.includes(option.value)
          ? `You can select up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS} always-computed unit dimensions.`
          : undefined,
    }));
  const hasMetrics =
    goalMetrics.length > 0 ||
    guardrailMetrics.length > 0 ||
    secondaryMetrics.length > 0;
  const phaseObj = experiment.phases[experiment.phases.length - 1];

  return (
    <>
      {renderGroups({
        hasCounting:
          !!datasourceProperties?.separateExperimentResultQueries ||
          hasEligiblePrecomputedUnitDimensions ||
          hasMetrics,
        hasOverrides: hasMetrics,
        who: (
          <Box>
            {/* Start Time, End Time (once stopped) and Activation Metric are
              as wide as the Custom SQL Filter below (set in review): each in
              the same row as it, with an empty column where its "Available
              columns" panel is. The same Bootstrap grid, so the widths match
              at every breakpoint. LEGACY: Bootstrap's grid, as the SQL
              filter's own layout uses. */}
            {phaseObj ? (
              <div className="row">
                <div className="col">
                  <DatePicker
                    label="Start Time (UTC)"
                    helpText="Only include users who entered the experiment on or after this date"
                    date={form.watch("dateStarted")}
                    setDate={(v) => {
                      form.setValue("dateStarted", v ? datetime(v) : "");
                    }}
                    scheduleEndDate={form.watch("dateEnded")}
                    disableAfter={form.watch("dateEnded") || undefined}
                    disabled={!editable}
                  />
                </div>
                <div className={SQL_FILTER_ASIDE} aria-hidden />
              </div>
            ) : null}
            {phaseObj && experiment.status === "stopped" ? (
              <div className="row">
                <div className="col">
                  <DatePicker
                    label="End Time (UTC)"
                    helpText="Only include users who entered the experiment on or before this date"
                    date={form.watch("dateEnded")}
                    setDate={(v) => {
                      form.setValue("dateEnded", v ? datetime(v) : "");
                    }}
                    scheduleStartDate={form.watch("dateStarted")}
                    disableBefore={form.watch("dateStarted") || undefined}
                    disabled={!editable}
                  />
                </div>
                <div className={SQL_FILTER_ASIDE} aria-hidden />
              </div>
            ) : null}
            {!!datasource && (
              <>
                <div className="row">
                  <div className="col">
                    <Tooltip
                      shouldDisplay={
                        isExperimentIncludedInIncrementalRefresh &&
                        form.watch("activationMetric") === ""
                      }
                      body="Activation Metrics are not yet supported with Incremental Refresh. Contact support if needed."
                    >
                      <MetricSelector
                        disabled={
                          !editable || isExperimentIncludedInIncrementalRefresh
                        }
                        datasource={experiment.datasource}
                        exposureQueryId={experiment.exposureQueryId}
                        project={experiment.project}
                        includeFacts={true}
                        label={
                          // The info icon as the Setup page's others (Target MDE): a
                          // 12px Phosphor icon in --slate-10, 4px after the label, with
                          // @/ui/Tooltip's small tooltip. The eligibility rules
                          // MetricsSelectorTooltip listed, as one sentence (set in review).
                          <Flex
                            as="span"
                            display="inline-flex"
                            align="center"
                            gap="1"
                          >
                            Activation Metric
                            {!isExperimentIncludedInIncrementalRefresh ? (
                              <UITooltip content={ACTIVATION_METRIC_INFO}>
                                <span
                                  className={styles.infoIcon}
                                  aria-label={ACTIVATION_METRIC_INFO}
                                >
                                  <PiInfo size={12} aria-hidden />
                                </span>
                              </UITooltip>
                            ) : null}
                          </Flex>
                        }
                        initialOption="None"
                        onlyBinomial
                        value={form.watch("activationMetric")}
                        onChange={(value) =>
                          form.setValue("activationMetric", value || "")
                        }
                        helpText="Users must convert on this metric before being included"
                      />
                    </Tooltip>
                  </div>
                  <div className={SQL_FILTER_ASIDE} aria-hidden />
                </div>
                {isExperimentIncludedInIncrementalRefresh &&
                form.watch("activationMetric") !== "" ? (
                  <Callout status="warning" mb="2">
                    Activation metrics are not yet supported with Incremental
                    Refresh. Please{" "}
                    <Link
                      style={{ display: "inline" }}
                      onClick={() => form.setValue("activationMetric", "")}
                    >
                      click to remove it
                    </Link>
                    .
                  </Callout>
                ) : null}
              </>
            )}
            <Box mt="4">
              {datasourceProperties?.experimentSegments &&
              filteredSegments.length > 0 ? (
                <div className="form-group mb-2">
                  <SelectField
                    label="Segment"
                    labelClassName="font-weight-bold"
                    value={form.watch("segment")}
                    onChange={(value) => form.setValue("segment", value || "")}
                    initialOption="None (All Users)"
                    options={filteredSegments.map((s) => ({
                      label: s.name,
                      value: s.id,
                    }))}
                    helpText="Only users in this segment will be included"
                    disabled={!editable}
                  />
                </div>
              ) : null}
              {datasourceProperties?.queryLanguage === "sql" ? (
                <div className="form-group mb-2">
                  <div className="row">
                    <div className="col">
                      <Field
                        label="Custom SQL Filter"
                        labelClassName="font-weight-bold"
                        {...form.register("queryFilter")}
                        textarea
                        placeholder="e.g. user_id NOT IN ('123', '456')"
                        helpText="WHERE clause to add to the default experiment query"
                        disabled={!editable}
                      />
                    </div>
                    <div className={`pt-2 border-left ${SQL_FILTER_ASIDE}`}>
                      Available columns:
                      <div className="mb-2 d-flex flex-wrap">
                        {["timestamp", "variation_id"]
                          .concat(
                            exposureQuery ? [exposureQuery.userIdType] : [],
                          )
                          .concat(exposureQuery?.dimensions || [])
                          .map((d) => (
                            <div className="mr-2 mb-2 border px-1" key={d}>
                              <code>{d}</code>
                            </div>
                          ))}
                      </div>
                      <div>
                        <strong>Tip:</strong> Use a subquery inside an{" "}
                        <code>IN</code> or <code>NOT IN</code> clause for more
                        advanced filtering.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {/* New (set in review): each variation's ID, edited in place. A
              mapping table only: the ID and nothing else, no name, weight, order
              or add/remove. Replaces the Edit Traffic & Variations modal's
              "Advanced mode" ID column. The helper line is this feature's only
              documentation; keep it whole. It's in the label's info tooltip
              (set in review), styled as Activation Metric's. */}
              <div className="form-group mb-2">
                <label className="font-weight-bold mb-1">
                  <Flex as="span" display="inline-flex" align="center" gap="1">
                    Variation IDs
                    <UITooltip content={VARIATION_IDS_INFO}>
                      <span
                        className={styles.infoIcon}
                        aria-label={VARIATION_IDS_INFO}
                      >
                        <PiInfo size={12} aria-hidden />
                      </span>
                    </UITooltip>
                  </Flex>
                </label>
                {/* Two columns (set in review): the names as wide as the
                  longest (up to 240px; longer ones wrap), then each 160px ID
                  field 24px after it, all lined up, rather than pushed to the
                  card's right edge. 8px between rows. The IDs in the page
                  font, Inter (set in review; they were in the code font). */}
                <Grid
                  columns="fit-content(240px) 160px"
                  gapX="5"
                  gapY="2"
                  align="center"
                >
                  {experiment.variations.map((variation, i) => (
                    <Fragment key={variation.id}>
                      {/* The variation's colour, as on its card. */}
                      <Flex align="center" gap="2" minWidth="0">
                        <ValueDot index={i} />
                        <Text>{variation.name}</Text>
                      </Flex>
                      <TextField
                        size="md"
                        value={form.watch("variationKeys")[i] ?? ""}
                        onChange={(e) => {
                          const keys = [...form.getValues("variationKeys")];
                          keys[i] = e.target.value;
                          form.setValue("variationKeys", keys);
                        }}
                        aria-label={`ID for ${variation.name}`}
                        disabled={!editable}
                      />
                    </Fragment>
                  ))}
                </Grid>
              </div>
            </Box>
          </Box>
        ),
        counting: (
          <Box>
            {datasourceProperties?.separateExperimentResultQueries ? (
              <>
                <div className="form-group mb-2">
                  <Tooltip
                    shouldDisplay={isExperimentIncludedInIncrementalRefresh}
                    body="In-progress Conversions is not supported with Incremental Refresh while in beta"
                  >
                    <SelectField
                      // Renamed from "Metric Conversion Windows" (set in review).
                      label="In-progress conversions"
                      labelClassName="font-weight-bold"
                      value={form.watch("skipPartialData")}
                      onChange={(value) =>
                        form.setValue("skipPartialData", value)
                      }
                      options={[
                        {
                          label: "Include In-Progress Conversions",
                          value: "loose",
                        },
                        {
                          label: "Exclude In-Progress Conversions",
                          value: "strict",
                        },
                      ]}
                      isOptionDisabled={(option) =>
                        isExperimentIncludedInIncrementalRefresh &&
                        "value" in option &&
                        option.value === "strict"
                      }
                      helpText="How to treat users not enrolled in the experiment long enough to complete conversion window."
                      disabled={!editable}
                    />
                  </Tooltip>
                </div>
                <div className="form-group mb-2">
                  <MetricAnalysisWindowSelector
                    attributionModel={
                      form.watch("attributionModel") ||
                      orgSettings.attributionModel ||
                      "firstExposure"
                    }
                    lookbackOverride={form.watch("lookbackOverride")}
                    onAttributionModelChange={(v) =>
                      form.setValue("attributionModel", v)
                    }
                    onLookbackOverrideChange={(v) =>
                      form.setValue("lookbackOverride", v)
                    }
                    phaseEndDate={
                      experiment.status === "stopped" && phaseObj
                        ? getValidDate(phaseObj.dateEnded ?? "")
                        : new Date()
                    }
                    disabled={
                      !editable || isExperimentIncludedInIncrementalRefresh
                    }
                    // Renamed from "Metric Analysis Windows" (set in review).
                    label="Metric window settings"
                  />
                </div>
              </>
            ) : null}
            <CustomMetricSlicesSelector
              className="mt-4 pt-4 border-top"
              goalMetrics={goalMetrics}
              secondaryMetrics={secondaryMetrics}
              guardrailMetrics={guardrailMetrics}
              customMetricSlices={form.watch("customMetricSlices") || []}
              setCustomMetricSlices={(slices) =>
                form.setValue("customMetricSlices", slices)
              }
            />
            {/* Only when there's something to show, so an empty wrapper
              doesn't add 16px to the bottom of the card. */}
            {hasEligiblePrecomputedUnitDimensions ? (
              <Box mt="4">
                <div className="form-group mb-2">
                  <MultiSelectField
                    label="Always-computed unit dimensions"
                    labelClassName="font-weight-bold"
                    helpText={`These dimensions will be computed automatically on every refresh, similar to precomputed dimensions. You can select up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS}. Changes apply on the next refresh.`}
                    value={selectedPrecomputedUnitDimensionIds}
                    options={precomputedUnitDimensionOptionsWithTooltips}
                    disabled={!editable}
                    isOptionDisabled={(option) => {
                      if (!("value" in option)) return false;
                      return (
                        precomputedUnitDimensionLimitReached &&
                        !selectedPrecomputedUnitDimensionIds.includes(
                          option.value,
                        )
                      );
                    }}
                    onChange={(v) =>
                      form.setValue(
                        "precomputedUnitDimensionIds",
                        v.slice(0, MAX_PRECOMPUTED_UNIT_DIMENSIONS),
                      )
                    }
                  />
                </div>
              </Box>
            ) : null}
          </Box>
        ),
        overrides: (
          <Box>
            {hasMetrics ? (
              <div className="form-group mb-2">
                <PremiumTooltip commercialFeature="override-metrics">
                  <label className="font-weight-bold mb-1">
                    Metric Overrides
                  </label>
                </PremiumTooltip>
                <Text as="p" size="sm" color="text-mid" mb="2">
                  Override metric behaviors within this experiment. Leave any
                  fields empty that you do not want to override.
                </Text>
                <MetricsOverridesSelector
                  experiment={experiment}
                  form={
                    form as unknown as UseFormReturn<EditMetricsFormInterface>
                  }
                  disabled={
                    !editable ||
                    !hasOverrideMetricsFeature ||
                    isExperimentIncludedInIncrementalRefresh
                  }
                />
              </div>
            ) : null}
          </Box>
        ),
      })}
    </>
  );
}
