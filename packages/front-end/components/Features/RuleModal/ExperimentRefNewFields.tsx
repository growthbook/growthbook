import { useFormContext } from "react-hook-form";
import {
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  SavedGroupTargeting,
} from "back-end/types/feature";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
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
import Toggle from "@/components/Forms/Toggle";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import Checkbox from "@/components/Radix/Checkbox";

export default function ExperimentRefNewFields({
  step,
  source,
  feature,
  project,
  environment,
  environments,
  defaultValues,
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
  noSchedule,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
  orgStickyBucketing,
}: {
  step: number;
  source: "rule" | "experiment";
  feature?: FeatureInterface;
  project?: string;
  environment?: string;
  environments?: string[];
  defaultValues?: FeatureRule | NewExperimentRefRule;
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
  noSchedule?: boolean;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
  orgStickyBucketing?: boolean;
}) {
  const form = useFormContext();

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project
  );

  const { namespaces } = useOrgSettings();

  return (
    <>
      {step === 0 ? (
        <>
          <Field
            required={true}
            minLength={2}
            label="实验名称"
            {...form.register("name")}
          />

          <Field
            label="追踪key"
            {...form.register(`trackingKey`)}
            placeholder={feature?.id || ""}
            helpText="此实验的唯一标识符，用于追踪展示次数并分析结果"
          />

          <Field
            label="假设"
            textarea
            minRows={1}
            {...form.register("hypothesis")}
            placeholder="例如：将注册按钮变大将增加点击次数并最终提高收益"
          />

          <Field
            label="描述"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="实验的简短人类可读描述"
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="mb-4">
            <SelectField
              label="基于属性分配值"
              containerClassName="flex-1"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "将与跟踪键一起哈希运算，以确定要分配的变体"
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

            {orgStickyBucketing ? (
              <Checkbox
                mt="4"
                size="lg"
                label="禁用粘性分桶"
                description="不要为此实验保留变体分配（覆盖您的组织设置）"
                value={!!form.watch("disableStickyBucketing")}
                setValue={(v) => {
                  form.setValue("disableStickyBucketing", v);
                }}
              />
            ) : null}
          </div>

          <FeatureVariationsInput
            label="流量百分比与变体"
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType ?? "string"}
            coverageLabel="此实验包含的流量"
            coverageTooltip={`未包含在实验中的用户将跳过此${source}`}
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
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
            revisions={revisions}
            version={version}
            environments={environment ? [environment] : environments ?? []}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {isCyclic && (
            <div className="alert alert-danger">
              <FaExclamationTriangle /> 一个先决条件（
              <code>{cyclicFeatureId}</code>）创建了一个循环依赖。
              请删除此先决条件以继续。
            </div>
          )}

          <hr />
          <div className="mt-4 mb-3">
            <Toggle
              value={form.watch("autoStart")}
              setValue={(v) => form.setValue("autoStart", v)}
              id="auto-start-new-experiment"
            />{" "}
            <label htmlFor="auto-start-new-experiment" className="text-dark">
              立即启动实验
            </label>
            <div>
              <small className="form-text text-muted">
                如果开启，一旦功能发布，实验将立即开始提供流量。
                如果您想在启动前进行其他更改，请保持关闭。
              </small>
            </div>
            {!noSchedule &&
              !form.watch("autoStart") &&
              setScheduleToggleEnabled ? (
              <div>
                <hr />
                <ScheduleInputs
                  defaultValue={defaultValues?.scheduleRules || []}
                  onChange={(value) => form.setValue("scheduleRules", value)}
                  scheduleToggleEnabled={!!scheduleToggleEnabled}
                  setScheduleToggleEnabled={setScheduleToggleEnabled}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}