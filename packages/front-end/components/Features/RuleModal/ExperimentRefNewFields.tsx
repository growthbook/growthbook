import { useFormContext } from "react-hook-form";
import {
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  SavedGroupTargeting,
} from "shared/types/feature";
import React from "react";
import Collapsible from "react-collapsible";
import { Flex, Tooltip, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { PiCaretRightFill } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import {
  getFeatureDefaultValue,
  NewExperimentRefRule,
  useAttributeSchema,
} from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import Checkbox from "@/ui/Checkbox";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { MetricsSelectorTooltip } from "@/components/Experiment/MetricsSelector";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import { useTemplates } from "@/hooks/useTemplates";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { convertTemplateToExperimentRule } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import HelperText from "@/ui/HelperText";

export default function ExperimentRefNewFields({
  step,
  source,
  feature,
  project,
  environments,
  defaultValues,
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
  noSchedule,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
  variationValuesAsIds = false,
  hideVariationIds = true,
  startEditingIndexes = false,
  orgStickyBucketing,
  setCustomFields,
  isTemplate = false,
  holdoutHashAttribute,
}: {
  step: number;
  source: "rule" | "experiment";
  feature?: FeatureInterface;
  project?: string;
  environments: string[];
  defaultValues?: FeatureRule | NewExperimentRefRule;
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
  noSchedule?: boolean;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight?: (i: number, w: number) => void;
  variations?: SortableVariation[];
  setVariations?: (v: SortableVariation[]) => void;
  variationValuesAsIds?: boolean;
  hideVariationIds?: boolean;
  startEditingIndexes?: boolean;
  orgStickyBucketing?: boolean;
  setCustomFields?: (customFields: Record<string, string>) => void;
  isTemplate?: boolean;
  holdoutHashAttribute?: string;
}) {
  const form = useFormContext();

  const {
    segments,
    getDatasourceById,
    getExperimentMetricById,
    getSegmentById,
    datasources,
    project: currentProject,
  } = useDefinitions();
  const { templates: allTemplates, templatesMap } = useTemplates();
  const { hasCommercialFeature } = useUser();

  const availableTemplates = allTemplates
    .slice()
    .sort((a, b) =>
      a.templateMetadata.name > b.templateMetadata.name ? 1 : -1,
    )
    .filter((t) =>
      isProjectListValidForProject(
        t.project ? [t.project] : [],
        currentProject,
      ),
    )
    .map((t) => ({ value: t.id, label: t.templateMetadata.name }));

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;
  const datasourceProperties = datasource?.properties;

  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.getValues("exposureQueryId");

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project,
  );

  const filteredSegments = segments.filter(
    (s) => s.datasource === datasource?.id,
  );

  const settings = useOrgSettings();
  const { namespaces, statsEngine: orgStatsEngine } = useOrgSettings();

  const templateRequired =
    hasCommercialFeature("templates") &&
    settings.requireExperimentTemplates &&
    availableTemplates.length >= 1;

  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    project,
  );

  return (
    <>
      {step === 0 ? (
        <>
          {availableTemplates.length >= 1 && (
            <div className="form-group">
              <PremiumTooltip commercialFeature="templates">
                <label>Select Template</label>
              </PremiumTooltip>
              <SelectField
                value={form.watch("templateId") ?? ""}
                onChange={(t) => {
                  if (t === "") {
                    form.setValue("templateId", undefined);
                    form.reset();
                    return;
                  }
                  form.setValue("templateId", t);
                  // Convert template to NewExperimentRefRule interface shape and reset values
                  const template = templatesMap.get(t);
                  if (!template) return;

                  const templateAsExperimentRule =
                    convertTemplateToExperimentRule({
                      template,
                      defaultValue: feature
                        ? getFeatureDefaultValue(feature)
                        : "",
                      attributeSchema,
                    });
                  form.reset(templateAsExperimentRule, {
                    keepDefaultValues: true,
                  });
                }}
                name="template"
                initialOption={"None"}
                options={availableTemplates}
                formatOptionLabel={(value) => {
                  const t = templatesMap.get(value.value);
                  if (!t) return <span>{value.label}</span>;
                  return (
                    <Flex as="div" align="baseline">
                      <Text>{value.label}</Text>
                      <Text size="1" className="text-muted" ml="auto">
                        Created {date(t.dateCreated)}
                      </Text>
                    </Flex>
                  );
                }}
                helpText={
                  templateRequired
                    ? "Your organization requires experiments to be created from a template"
                    : undefined
                }
                disabled={!hasCommercialFeature("templates")}
                required={templateRequired}
              />
            </div>
          )}
          <Field
            required={true}
            minLength={2}
            label="Experiment Name"
            {...form.register("name")}
          />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature?.id || ""}
            helpText="Unique identifier for this Experiment, used to track impressions and analyze results"
          />

          <Field
            label="Hypothesis"
            textarea
            minRows={1}
            {...form.register("hypothesis")}
            placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          />

          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="Short human-readable description of the Experiment"
          />

          {hasCommercialFeature("custom-metadata") &&
            !!customFields?.length && (
              <CustomFieldInput
                customFields={customFields}
                currentCustomFields={form.watch("customFields")}
                setCustomFields={setCustomFields ? setCustomFields : () => {}}
                section={"experiment"}
                project={project}
              />
            )}
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
            {!!holdoutHashAttribute &&
              form.watch("hashAttribute") !== holdoutHashAttribute && (
                <HelperText status="warning" size="sm" mb="4">
                  The hash attribute of this experiment does not match the hash
                  attribute of the holdout this experiment will belong to.
                </HelperText>
              )}
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
            />

            {hasSDKWithNoBucketingV2 && !isTemplate && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={project}
              />
            )}

            {orgStickyBucketing && !isTemplate ? (
              <Checkbox
                mt="4"
                size="lg"
                label="Disable Sticky Bucketing"
                description="Do not persist variation assignments for this experiment (overrides your organization settings)"
                value={!!form.watch("disableStickyBucketing")}
                setValue={(v) => {
                  form.setValue("disableStickyBucketing", v);
                }}
              />
            ) : null}
          </div>

          <FeatureVariationsInput
            label="Traffic Percent & Variations"
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType}
            coverageLabel="Traffic included in this Experiment"
            coverageTooltip={`Users not included in the Experiment will skip this ${source}`}
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
            feature={feature}
            valueAsId={variationValuesAsIds}
            hideVariationIds={hideVariationIds}
            hideVariations={isTemplate}
            disableVariations={isTemplate}
            startEditingIndexes={startEditingIndexes}
          />

          {!isTemplate && namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              formPrefix={namespaceFormPrefix}
              trackingKey={form.watch("trackingKey") || feature?.id}
              featureId={feature?.id || ""}
            />
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SavedGroupTargetingField
            value={savedGroupValue}
            setValue={setSavedGroupValue}
            project={project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={defaultConditionValue}
            onChange={setConditionValue}
            key={conditionKey}
            project={project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={prerequisiteValue}
            setValue={setPrerequisiteValue}
            feature={feature}
            environments={environments ?? []}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {isCyclic && (
            <Callout status="error">
              A prerequisite (<code>{cyclicFeatureId}</code>) creates a circular
              dependency. Remove this prerequisite to continue.
            </Callout>
          )}

          {!isTemplate &&
          source === "rule" &&
          !noSchedule &&
          setScheduleToggleEnabled ? (
            <div className="mt-4 mb-3">
              <hr className="mb-4" />
              <ScheduleInputs
                defaultValue={defaultValues?.scheduleRules || []}
                onChange={(value) => form.setValue("scheduleRules", value)}
                scheduleToggleEnabled={!!scheduleToggleEnabled}
                setScheduleToggleEnabled={setScheduleToggleEnabled}
              />
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
              onChange={(newDatasource) => {
                form.setValue("datasource", newDatasource);

                // If unsetting the datasource, leave all the other settings alone
                // That way, it will be restored if the user switches back to the previous value
                if (!newDatasource) return;

                const isValidMetric = (id: string) =>
                  getExperimentMetricById(id)?.datasource === newDatasource;

                // If the segment is now invalid
                const segment = form.watch("segment");
                if (
                  segment &&
                  getSegmentById(segment)?.datasource !== newDatasource
                ) {
                  form.setValue("segment", "");
                }

                // If the activationMetric is now invalid
                const activationMetric = form.watch("activationMetric");
                if (activationMetric && !isValidMetric(activationMetric)) {
                  form.setValue("activationMetric", "");
                }
              }}
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

            {datasourceProperties?.exposureQueries && exposureQueries ? (
              <SelectField
                label={
                  <>
                    Experiment Assignment Table{" "}
                    <Tooltip content="Should correspond to the Identifier Type used to randomize units for this experiment" />
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

          <ExperimentMetricsSelector
            datasource={datasource?.id}
            exposureQueryId={exposureQueryId}
            project={project}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            setGoalMetrics={(goalMetrics) =>
              form.setValue("goalMetrics", goalMetrics)
            }
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
              {!!datasource && (
                <MetricSelector
                  datasource={form.watch("datasource")}
                  exposureQueryId={exposureQueryId}
                  project={project}
                  includeFacts={true}
                  labelClassName="font-weight-bold"
                  label={
                    <>
                      Activation Metric{" "}
                      <MetricsSelectorTooltip
                        onlyBinomial={true}
                        isSingular={true}
                      />
                    </>
                  }
                  initialOption="None"
                  onlyBinomial
                  value={form.watch("activationMetric")}
                  onChange={(value) =>
                    form.setValue("activationMetric", value || "")
                  }
                  helpText="Users must convert on this metric before being included"
                />
              )}
              {datasourceProperties?.experimentSegments && (
                <SelectField
                  label="Segment"
                  labelClassName="font-weight-bold"
                  value={form.watch("segment")}
                  onChange={(value) => form.setValue("segment", value || "")}
                  initialOption="None (All Users)"
                  options={filteredSegments.map((s) => {
                    return {
                      label: s.name,
                      value: s.id,
                    };
                  })}
                  helpText="Only users in this segment will be included"
                />
              )}
              {datasourceProperties?.separateExperimentResultQueries && (
                <SelectField
                  label="Metric Conversion Windows"
                  labelClassName="font-weight-bold"
                  value={form.watch("skipPartialData")}
                  onChange={(value) => form.setValue("skipPartialData", value)}
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
                  helpText="For users not enrolled in the experiment long enough to complete conversion window"
                />
              )}
              <StatsEngineSelect
                className="mb-4"
                label={<div>Statistics Engine</div>}
                value={form.watch("statsEngine") ?? orgStatsEngine}
                onChange={(v) => form.setValue("statsEngine", v)}
                allowUndefined={false}
              />
            </div>
          </Collapsible>
        </>
      ) : null}
    </>
  );
}
