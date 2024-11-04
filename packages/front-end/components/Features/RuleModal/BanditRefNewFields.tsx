import { useFormContext } from "react-hook-form";
import {
  FeatureInterface,
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "back-end/types/feature";
import React, { useEffect } from "react";
import { FaAngleRight, FaExclamationTriangle } from "react-icons/fa";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import Collapsible from "react-collapsible";
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
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function BanditRefNewFields({
  step,
  source,
  feature,
  project,
  environment,
  environments,
  revisions,
  version,
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
  environment?: string;
  environments?: string[];
  revisions?: FeatureRevisionInterface[];
  version?: number;
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
    "regression-adjustment"
  );

  const {
    datasources,
    getDatasourceById,
    getExperimentMetricById,
  } = useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.getValues("exposureQueryId");
  console.log({ exposureQueryId });

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
    project
  );

  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();

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
              label="Assign value based on attribute"
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
          <PrerequisiteTargetingField
            value={prerequisiteValue}
            setValue={setPrerequisiteValue}
            // value={form.watch("prerequisites") || []}
            // setValue={(prerequisites) =>
            //   form.setValue("prerequisites", prerequisites)
            // }
            feature={feature}
            revisions={revisions}
            version={version}
            environments={environment ? [environment] : environments ?? []}
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
              onChange={(newDatasource) => {
                form.setValue("datasource", newDatasource);

                // If unsetting the datasource, leave all the other settings alone
                // That way, it will be restored if the user switches back to the previous value
                if (!newDatasource) {
                  return;
                }

                const isValidMetric = (id: string) =>
                  getExperimentMetricById(id)?.datasource === newDatasource;

                // Filter the selected metrics to only valid ones
                const goals = form.watch("goalMetrics") ?? [];
                form.setValue("goalMetrics", goals.filter(isValidMetric));

                const secondaryMetrics = form.watch("secondaryMetrics") ?? [];
                form.setValue(
                  "secondaryMetrics",
                  secondaryMetrics.filter(isValidMetric)
                );

                // const guardrails = form.watch("guardrailMetrics") ?? [];
                // form.setValue("guardrailMetrics", guardrails.filter(isValidMetric));
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

            {exposureQueries ? (
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
                    (e) => e.id === value
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
            forceSingleGoalMetric={true}
            noPercentileGoalMetrics={true}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            setGoalMetrics={(goalMetrics) =>
              form.setValue("goalMetrics", goalMetrics)
            }
          />

          <div className="mt-2 mb-3">
            <BanditSettings page="experiment-settings" />
          </div>

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

          <Collapsible
            trigger={
              <div className="link-purple font-weight-bold mt-4 mb-2">
                <FaAngleRight className="chevron mr-1" />
                Advanced Settings
              </div>
            }
            transitionTime={100}
          >
            <div className="box pt-3 px-3 mt-1">
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
