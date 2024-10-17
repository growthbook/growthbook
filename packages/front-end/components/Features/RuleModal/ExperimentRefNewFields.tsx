import { useFormContext } from "react-hook-form";
import {ExperimentValue, FeatureInterface, FeatureRule} from "back-end/types/feature";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import {ExperimentType} from "back-end/types/experiment";
import {FaRegCircleCheck} from "react-icons/fa6";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {AppFeatures} from "@/types/app-features";
import {useUser} from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import HashVersionSelector, {allConnectionsSupportBucketingV2} from "@/components/Experiment/HashVersionSelector";
import {
  generateVariationId,
  getFeatureDefaultValue,
  NewExperimentRefRule,
  useAttributeSchema
} from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import React from "react";
import {FaExclamationTriangle} from "react-icons/fa";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import Toggle from "@/components/Forms/Toggle";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import {useIncrementer} from "@/hooks/useIncrementer";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";

export default function ExperimentRefNewFields({
  feature,
  environment,
  defaultValues,
  revisions,
  version,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  // legacy:
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  setShowUpgradeModal,
}: {
  feature: FeatureInterface;
  environment: string;
  defaultValues: FeatureRule | NewExperimentRefRule;
  revisions?: FeatureRevisionInterface[];
  version: number;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;

  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
  setShowUpgradeModal: (b: boolean) => void;
}) {
  const form = useFormContext();

  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project
  );

  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();
  const growthbook = useGrowthBook<AppFeatures>();

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
  );
  const usingStickyBucketing = !!settings.useStickyBucketing;

  const [conditionKey, forceConditionRender] = useIncrementer();

  return (
    <>
      <Page display="New Experiment">
        <>
          {growthbook.isOn("bandits") && (
            <div className="bg-highlight rounded py-3 px-3 mb-4">
              <ButtonSelectField
                buttonType="card"
                value={form.watch("experimentType") || ""}
                setValue={(v) =>
                  form.setValue("experimentType", v as ExperimentType)
                }
                options={[
                  {
                    label: (
                      <div
                        className="mx-3 d-flex flex-column align-items-center justify-content-center"
                        style={{ minHeight: 90 }}
                      >
                        <div className="h4">
                          {form.watch("experimentType") === "standard" && (
                            <FaRegCircleCheck
                              size={18}
                              className="check text-success mr-2"
                            />
                          )}
                          Experiment
                        </div>
                        <div className="small">
                          Variation weights are constant throughout the
                          experiment
                        </div>
                      </div>
                    ),
                    value: "standard",
                  },
                  {
                    label: (
                      <div
                        className="mx-3 d-flex flex-column align-items-center justify-content-center"
                        style={{ minHeight: 90 }}
                      >
                        <div className="h4">
                          <PremiumTooltip
                            commercialFeature="multi-armed-bandits"
                            body={
                              !usingStickyBucketing &&
                              hasStickyBucketFeature ? (
                                <div>
                                  Enable Sticky Bucketing in your organization
                                  settings to run a Bandit.
                                </div>
                              ) : null
                            }
                            usePortal={true}
                          >
                            {form.watch("experimentType") ===
                              "multi-armed-bandit" && (
                                <FaRegCircleCheck
                                  size={18}
                                  className="check text-success mr-2"
                                />
                              )}
                            Bandit
                          </PremiumTooltip>
                        </div>

                        <div className="small">
                          Variations with better results receive more traffic
                          during the experiment
                        </div>
                      </div>
                    ),
                    value: "multi-armed-bandit",
                    disabled:
                      !hasMultiArmedBanditFeature || !usingStickyBucketing,
                  },
                ]}
              />
            </div>
          )}

          <Field
            label={
              form.watch("experimentType") === "multi-armed-bandit"
                ? "Bandit Name"
                : "Experiment Name"
            }
            {...form.register("name")}
            required
          />

          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="Short human-readable description of the rule"
          />

          <>
            <div className="mt-4 mb-4">
              <Field
                label="Tracking Key"
                {...form.register(`trackingKey`)}
                placeholder={feature.id}
                helpText="Unique identifier for this experiment, used to track impressions and analyze results"
              />
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
            </div>
            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={feature.project}
              />
            )}
            <hr />
          </>
        </>
      </Page>

      <Page display="Targeting">
        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) =>
            form.setValue("savedGroups", savedGroups)
          }
          project={feature.project || ""}
        />
        <hr/>
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(value) => form.setValue("condition", value)}
          key={conditionKey}
          project={feature.project || ""}
        />
        <hr/>
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
            <FaExclamationTriangle/> A prerequisite (
            <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
            this prerequisite to continue.
          </div>
        )}

        <div>
          {namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
          <div className="mb-4">
            <FeatureVariationsInput
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
              setVariations={(variations) =>
                form.setValue("values", variations)
              }
              feature={feature}
              simple={form.watch("experimentType") === "multi-armed-bandit"}
            />
          </div>
        </div>


        {form.watch("type") === "experiment-ref-new" &&
          form.watch("experimentType") !== "multi-armed-bandit" && (
            <div className="mb-3">
              <Toggle
                value={form.watch("autoStart")}
                setValue={(v) => form.setValue("autoStart", v)}
                id="auto-start-new-experiment"
              />{" "}
              <label htmlFor="auto-start-new-experiment" className="text-dark">
                Start Experiment Immediately
              </label>
              <div>
                <small className="form-text text-muted">
                  If On, the experiment will start serving traffic as soon as the
                  feature is published. Leave Off if you want to make additional
                  changes before starting.
                </small>
              </div>
              {!form.watch("autoStart") && (
                <div>
                  <hr />
                  <ScheduleInputs
                    defaultValue={defaultValues.scheduleRules || []}
                    onChange={(value) => form.setValue("scheduleRules", value)}
                    scheduleToggleEnabled={scheduleToggleEnabled}
                    setScheduleToggleEnabled={setScheduleToggleEnabled}
                    setShowUpgradeModal={setShowUpgradeModal}
                  />
                </div>
              )}
            </div>
          )}
      </Page>
    </>
  );
}
