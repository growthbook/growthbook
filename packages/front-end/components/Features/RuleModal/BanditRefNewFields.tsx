import { useFormContext } from "react-hook-form";
import {
  FeatureInterface,
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/types/feature";
import { useEffect, useMemo } from "react";
import { getMetricWindowHours } from "shared/experiments";
import { FaExclamationTriangle } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Grid, Separator } from "@radix-ui/themes";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import {
  getFeatureDefaultValue,
  useAttributeSchema,
} from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import Tooltip from "@/components/Tooltip/Tooltip";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import Callout from "@/ui/Callout";

export default function BanditRefNewFields({
  step,
  source,
  feature,
  project,
  environments,
  prerequisiteValue,
  setPrerequisiteValue,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  savedGroupValue,
  setSavedGroupValue,
  defaultConditionValue,
  setConditionValue,
  conditionKey,
  namespaceFormPrefix = "",
  // variation input fields
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
}: {
  step: number;
  source: "rule" | "experiment";
  feature?: FeatureInterface;
  project?: string;
  environments: string[];
  prerequisiteValue: FeaturePrerequisite[];
  setPrerequisiteValue: (prerequisites: FeaturePrerequisite[]) => void;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic?: boolean;
  cyclicFeatureId?: string | null;
  savedGroupValue: SavedGroupTargeting[];
  setSavedGroupValue: (savedGroups: SavedGroupTargeting[]) => void;
  defaultConditionValue: string;
  setConditionValue: (s: string) => void;
  conditionKey: number;
  namespaceFormPrefix?: string;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
}) {
  const form = useFormContext();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );

  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.getValues("exposureQueryId");

  useEffect(() => {
    if (!exposureQueries?.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project,
  );

  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();

  // Calculate default conversion window from goal metric
  const goalMetricId = form.watch("goalMetrics")?.[0];
  const goalMetric = goalMetricId
    ? getExperimentMetricById(goalMetricId)
    : null;
  const goalMetricWindow =
    goalMetric?.windowSettings.type === "conversion"
      ? goalMetric.windowSettings
      : null;
  const defaultConversionWindowHours = useMemo(() => {
    if (goalMetric?.windowSettings.type === "conversion") {
      return getMetricWindowHours(goalMetric.windowSettings);
    }
    return 1; // Default to 1 hour if no metric
  }, [goalMetric]);

  // Set default conversion window override when Decision Metric changes for Bandit
  useEffect(() => {
    if (goalMetricId) {
      // Always update to match the metric's conversion window when metric changes
      if (defaultConversionWindowHours >= 24) {
        form.setValue(
          "banditConversionWindowValue",
          defaultConversionWindowHours / 24,
        );
        form.setValue("banditConversionWindowUnit", "days");
      } else {
        form.setValue(
          "banditConversionWindowValue",
          defaultConversionWindowHours,
        );
        form.setValue("banditConversionWindowUnit", "hours");
      }
    } else if (!goalMetricId) {
      // If no goal metric, set to 1 hour
      form.setValue("banditConversionWindowValue", 1);
      form.setValue("banditConversionWindowUnit", "hours");
    }
  }, [goalMetricId, defaultConversionWindowHours, form]);

  const conversionWindowUnit = form.watch("banditConversionWindowUnit");
  const conversionWindowValue = form.watch("banditConversionWindowValue");

  const conversionWindowOverrideHours = useMemo(() => {
    if (form.watch("disableConversionWindow")) {
      return null;
    }
    return conversionWindowValue && conversionWindowUnit
      ? parseFloat(String(conversionWindowValue)) *
          (conversionWindowUnit === "days" ? 24 : 1)
      : null;
  }, [form, conversionWindowValue, conversionWindowUnit]);

  const scheduleHours =
    parseFloat(form.watch("banditScheduleValue") ?? "0") *
    (form.watch("banditScheduleUnit") === "days" ? 24 : 1);

  const conversionWindowHours =
    conversionWindowOverrideHours ?? defaultConversionWindowHours;

  const showConversionWindowWarning =
    (!settings?.useStickyBucketing || !!form.watch("disableStickyBucketing")) &&
    conversionWindowHours &&
    scheduleHours < conversionWindowHours * 10;

  return (
    <>
      {step === 0 ? (
        <>
          <Field
            required={true}
            minLength={2}
            label="Bandit Name"
            {...form.register("name")}
          />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature?.id || ""}
            helpText="Unique identifier for this Bandit, used to track impressions and analyze results"
          />

          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="Short human-readable description of the Bandit"
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="mb-4">
            <SelectField
              label="Assign Variation by Attribute"
              containerClassName="flex-1"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "Will be hashed together with the Tracking Key to determine which variation to assign"
              }
            />
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
            />

            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={project}
              />
            )}
          </div>

          <FeatureVariationsInput
            simple={true}
            label="Traffic Percent & Variations"
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType ?? "string"}
            coverageLabel="Traffic included in this Bandit"
            coverageTooltip={`Users not included in the Bandit will skip this ${source}`}
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
            <div className="mt-4">
              <NamespaceSelector
                form={form}
                formPrefix={namespaceFormPrefix}
                trackingKey={form.watch("trackingKey") || feature?.id}
                featureId={feature?.id || ""}
              />
            </div>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SavedGroupTargetingField
            value={savedGroupValue}
            setValue={setSavedGroupValue}
            // value={form.watch("savedGroups") || []}
            // setValue={(savedGroups) =>
            //   form.setValue("savedGroups", savedGroups)
            // }
            project={project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={defaultConditionValue}
            onChange={setConditionValue}
            // defaultValue={form.watch("condition") || ""}
            // onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
            project={project || ""}
          />
          <hr />
          <PrerequisiteInput
            value={prerequisiteValue}
            setValue={setPrerequisiteValue}
            feature={feature}
            environments={environments ?? []}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {isCyclic ? (
            <div className="alert alert-danger">
              <FaExclamationTriangle /> A prerequisite (
              <code>{cyclicFeatureId}</code>) creates a circular dependency.
              Remove this prerequisite to continue.
            </div>
          ) : null}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <SelectField
              label="Data Source"
              labelClassName="font-weight-bold"
              value={form.watch("datasource") ?? ""}
              onChange={(newDatasource) =>
                form.setValue("datasource", newDatasource)
              }
              options={datasources.map((d) => {
                const isDefaultDataSource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  }${isDefaultDataSource ? " (default)" : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
            />

            {datasource?.properties?.exposureQueries && exposureQueries ? (
              <SelectField
                label={
                  <>
                    Experiment Assignment Table{" "}
                    <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                  </>
                }
                labelClassName="font-weight-bold"
                value={form.watch("exposureQueryId") ?? ""}
                onChange={(v) => form.setValue("exposureQueryId", v)}
                required
                options={exposureQueries?.map((q) => {
                  return {
                    label: q.name,
                    value: q.id,
                  };
                })}
                formatOptionLabel={({ label, value }) => {
                  const userIdType = exposureQueries?.find(
                    (e) => e.id === value,
                  )?.userIdType;
                  return (
                    <>
                      {label}
                      {userIdType ? (
                        <span
                          className="text-muted small float-right position-relative"
                          style={{ top: 3 }}
                        >
                          Identifier Type: <code>{userIdType}</code>
                        </span>
                      ) : null}
                    </>
                  );
                }}
              />
            ) : null}
          </div>

          <Box my="4">
            <BanditSettings page="experiment-settings" />
          </Box>

          {settings?.useStickyBucketing && (
            <Switch
              label="Disable Sticky Bucketing"
              description="Avoid potential “double counting” when identifier type and metric identifier don't match."
              value={!!form.watch("disableStickyBucketing")}
              onChange={(v) => {
                form.setValue("disableStickyBucketing", v);
              }}
              mb="5"
              mt="5"
            />
          )}

          <Separator my="5" size="4" />

          <ExperimentMetricsSelector
            datasource={datasource?.id}
            exposureQueryId={exposureQueryId}
            project={project}
            forceSingleGoalMetric={true}
            noQuantileGoalMetrics={true}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            setGoalMetrics={(goalMetrics) =>
              form.setValue("goalMetrics", goalMetrics)
            }
          />

          {!settings?.useStickyBucketing ||
            (!!form.watch("disableStickyBucketing") && (
              <Box my="5">
                <Text size="medium" weight="semibold">
                  Decision Metric Conversion Window Override
                </Text>
                {goalMetricWindow?.windowUnit &&
                  goalMetricWindow?.windowValue && (
                    <Text color="text-mid" size="small" as="p" my="1">
                      Metric default: {goalMetricWindow.windowValue}{" "}
                      {goalMetricWindow.windowUnit}
                    </Text>
                  )}
                <Grid align="end" flow="column" gap="5" columns="auto">
                  <Grid
                    align="center"
                    flow="column"
                    gap="2"
                    columns="auto"
                    mt="2"
                  >
                    <Field
                      {...form.register("banditConversionWindowValue", {
                        valueAsNumber: true,
                      })}
                      type="number"
                      min={0}
                      max={999}
                      step={"any"}
                      style={{ width: 70 }}
                      disabled={form.watch("disableConversionWindow")}
                      className={clsx({
                        "border-warning":
                          showConversionWindowWarning &&
                          !form.watch("disableConversionWindow"),
                      })}
                    />
                    <SelectField
                      value={
                        form.watch("banditConversionWindowUnit") || "hours"
                      }
                      onChange={(value) => {
                        form.setValue(
                          "banditConversionWindowUnit",
                          value as "hours" | "days",
                        );
                      }}
                      sort={false}
                      options={[
                        {
                          label: "Hour(s)",
                          value: "hours",
                        },
                        {
                          label: "Day(s)",
                          value: "days",
                        },
                      ]}
                      disabled={form.watch("disableConversionWindow")}
                      style={{ width: 90, minWidth: 90 }}
                    />
                  </Grid>
                  <Box width="100px" />
                  <Checkbox
                    description="Use the Decision Metric's default conversion window"
                    label="Disable Conversion Window"
                    labelSize="1"
                    size="sm"
                    value={!!form.watch("disableConversionWindow")}
                    setValue={(v) => {
                      form.setValue("disableConversionWindow", v);
                    }}
                  />
                </Grid>
                {form.watch("disableConversionWindow") &&
                  !goalMetricWindow?.windowUnit &&
                  !goalMetricWindow?.windowValue && (
                    <Callout status="warning" my="4">
                      Disabling the conversion window may bias results if units
                      switch variations during the experiment.
                    </Callout>
                  )}
                {showConversionWindowWarning && (
                  <Callout status="warning" my="4">
                    <Text>
                      To prevent counting conversions after a unit may have
                      switched assignment, decrease metric conversion window to
                      use &le; 10% time of{" "}
                      <Text weight="semibold">Update Cadence</Text>.
                    </Text>
                  </Callout>
                )}
              </Box>
            ))}

          <ExperimentMetricsSelector
            datasource={datasource?.id}
            exposureQueryId={exposureQueryId}
            project={project}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            setSecondaryMetrics={(secondaryMetrics) =>
              form.setValue("secondaryMetrics", secondaryMetrics)
            }
            setGuardrailMetrics={(guardrailMetrics) =>
              form.setValue("guardrailMetrics", guardrailMetrics)
            }
            collapseSecondary={true}
            collapseGuardrail={true}
          />

          <CustomMetricSlicesSelector
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            customMetricSlices={form.watch("customMetricSlices") ?? []}
            setCustomMetricSlices={(slices) =>
              form.setValue("customMetricSlices", slices)
            }
          />

          <hr className="mt-4" />

          <Collapsible
            trigger={
              <div className="link-purple font-weight-bold mt-4 mb-2">
                <PiCaretRightFill className="chevron mr-1" />
                Advanced Settings
              </div>
            }
            transitionTime={100}
          >
            <div className="rounded px-3 pt-3 pb-1 bg-highlight">
              <StatsEngineSelect
                className="mb-4"
                label={
                  <>
                    <div>Statistics Engine</div>
                    <div className="small text-muted">
                      Only <strong>Bayesian</strong> is available for Bandit
                      Experiments.
                    </div>
                  </>
                }
                value={"bayesian"}
                allowUndefined={false}
                disabled={true}
              />

              <SelectField
                className="mb-4"
                label={
                  <PremiumTooltip commercialFeature="regression-adjustment">
                    <GBCuped /> Use Regression Adjustment (CUPED)
                  </PremiumTooltip>
                }
                labelClassName="font-weight-bold"
                value={form.watch("regressionAdjustmentEnabled") ? "on" : "off"}
                onChange={(v) => {
                  form.setValue("regressionAdjustmentEnabled", v === "on");
                }}
                options={[
                  {
                    label: "On",
                    value: "on",
                  },
                  {
                    label: "Off",
                    value: "off",
                  },
                ]}
                disabled={!hasRegressionAdjustmentFeature}
              />
            </div>
          </Collapsible>
        </>
      ) : null}
    </>
  );
}
