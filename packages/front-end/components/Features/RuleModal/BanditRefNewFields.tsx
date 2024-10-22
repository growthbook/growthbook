import { useFormContext } from "react-hook-form";
import { ExperimentValue, FeatureInterface } from "back-end/types/feature";
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
  generateVariationId,
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

export default function BanditRefNewFields({
  feature,
  environment,
  revisions,
  version,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  step,
}: {
  feature: FeatureInterface;
  environment: string;
  revisions?: FeatureRevisionInterface[];
  version: number;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  step: number;
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
    project,
  } = useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.getValues("exposureQueryId");
  const userIdType = exposureQueries?.find(
    (e) => e.id === form.getValues("exposureQueryId")
  )?.userIdType;

  useEffect(() => {
    if (!exposureQueries?.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project
  );

  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();

  return (
    <>
      {step === 0 ? (
        <>
          <Field label="Bandit Name" {...form.register("name")} required />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature.id}
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
            <div className="d-flex" style={{ gap: "2rem" }}>
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
            </div>

            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={feature.project}
              />
            )}
          </div>

          <FeatureVariationsInput
            simple={true}
            label="Traffic Percent & Variations"
            coverageLabel="Traffic included in this Bandit"
            coverageTooltip="Users not included in the Bandit will skip this rule"
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            coverage={form.watch("coverage") || 0}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`values.${i}.weight`, weight)
            }
            variations={
              form
                .watch("values")
                ?.map((v: ExperimentValue & { id?: string }) => {
                  return {
                    value: v.value || "",
                    name: v.name,
                    weight: v.weight,
                    id: v.id || generateVariationId(),
                  };
                }) || []
            }
            setVariations={(variations) => form.setValue("values", variations)}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
            <div className="mt-4">
              <NamespaceSelector
                form={form}
                trackingKey={form.watch("trackingKey") || feature.id}
                featureId={feature.id}
                formPrefix=""
              />
            </div>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("savedGroups", savedGroups)
            }
            project={feature.project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
            project={feature.project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={form.watch("prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            feature={feature}
            revisions={revisions}
            version={version}
            environments={[environment]}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {isCyclic && (
            <div className="alert alert-danger">
              <FaExclamationTriangle /> A prerequisite (
              <code>{cyclicFeatureId}</code>) creates a circular dependency.
              Remove this prerequisite to continue.
            </div>
          )}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <label>Bandit Schedule</label>
          <div className="rounded px-3 pt-3 pb-2 bg-highlight mb-4">
            <BanditSettings page="experiment-settings" />
          </div>

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
                label: `${d.name}${d.description ? ` — ${d.description}` : ""}${
                  isDefaultDataSource ? " (default)" : ""
                }`,
              };
            })}
            className="portal-overflow-ellipsis"
          />

          {exposureQueries ? (
            <SelectField
              label="Experiment Assignment Table"
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
              helpText={
                <>
                  <div>
                    Should correspond to the Identifier Type used to randomize
                    units for this experiment
                  </div>
                  {userIdType ? (
                    <>
                      Identifier Type: <code>{userIdType}</code>
                    </>
                  ) : null}
                </>
              }
            />
          ) : null}

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
