import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import React, { useEffect, useState } from "react";
import { validateAndFixCondition } from "shared/util";
import { getEqualWeights } from "shared/experiments";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import ConditionInput from "@/components//Features/ConditionInput";
import NamespaceSelector from "@/components//Features/NamespaceSelector";
import SelectField from "@/components//Forms/SelectField";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import RadioGroup, { RadioOptions } from "@/components/Radix/RadioGroup";
import Checkbox from "@/components/Radix/Checkbox";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "./HashVersionSelector";

export type ChangeType =
  | "targeting"
  | "traffic"
  | "weights"
  | "namespace"
  | "advanced"
  | "phase";

export type ReleasePlan =
  | "new-phase"
  | "same-phase-sticky"
  | "same-phase-everyone"
  | "new-phase-block-sticky" //advanced only
  | "new-phase-same-seed" // available from "new phase" only
  | "";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTargetingModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const { apiCall } = useAuth();
  const [conditionKey, forceConditionRender] = useIncrementer();

  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<ChangeType | undefined>();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project
  );

  const isBandit = experiment.type === "multi-armed-bandit";

  const [
    prerequisiteTargetingSdkIssues,
    setPrerequisiteTargetingSdkIssues,
  ] = useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const lastStepNumber = changeType !== "phase" ? 2 : 1;

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    prerequisites: lastPhase?.prerequisites ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    hashVersion: experiment.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
    disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    bucketVersion: experiment.bucketVersion || 1,
    minBucketVersion: experiment.minBucketVersion || 0,
    namespace: lastPhase?.namespace || {
      enabled: false,
      name: "",
      range: [0, 1],
    },
    seed: lastPhase?.seed ?? "",
    trackingKey: experiment.trackingKey || "",
    variationWeights:
      lastPhase?.variationWeights ??
      getEqualWeights(experiment.variations.length, 4),
    newPhase: false,
    reseed: true,
  };

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const _formValues = omit(form.getValues(), [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const _defaultValues = omit(defaultValues, [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const hasChanges = !isEqual(_formValues, _defaultValues);

  useEffect(() => {
    if (changeType !== "advanced") {
      form.reset();
    }
  }, [changeType, form]);

  useEffect(() => {
    if (step !== lastStepNumber) {
      if (changeType === "phase") {
        setReleasePlan("new-phase");
      } else {
        setReleasePlan("");
      }
      setChangesConfirmed(false);
    }
  }, [changeType, step, lastStepNumber, setReleasePlan]);

  const onSubmit = form.handleSubmit(async (value) => {
    validateSavedGroupTargeting(value.savedGroups);

    validateAndFixCondition(value.condition, (condition) => {
      form.setValue("condition", condition);
      forceConditionRender();
    });

    if (value.prerequisites) {
      if (value.prerequisites.some((p) => !p.id)) {
        throw new Error("不能有空的先决条件");
      }
    }

    if (prerequisiteTargetingSdkIssues) {
      throw new Error("先决条件目标定位问题必须解决");
    }

    await apiCall(`/experiment/${experiment.id}/targeting`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
    track("edit-experiment-targeting");
  });

  if (safeToEdit) {
    return (
      <Modal
        trackingEventModalType=""
        open={true}
        close={close}
        header={`编辑目标定位`}
        ctaEnabled={canSubmit}
        submit={onSubmit}
        cta="保存"
        size="lg"
      >
        <TargetingForm
          experiment={experiment}
          form={form}
          safeToEdit={true}
          conditionKey={conditionKey}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
      </Modal>
    );
  }

  let cta = "发布变更";
  let ctaEnabled = true;
  let blockSteps: number[] = [];
  if (!changeType) {
    cta = "选择变更类型";
    ctaEnabled = false;
    blockSteps = [1, 2];
  } else {
    if (changeType !== "phase" && !hasChanges) {
      if (step === 1) {
        cta = "无变更";
        ctaEnabled = false;
      }
      blockSteps = [lastStepNumber];
    }
    if (!releasePlan && step === lastStepNumber) {
      cta = "选择发布计划";
      ctaEnabled = false;
    }
    if (step == lastStepNumber && !changesConfirmed) {
      ctaEnabled = false;
    }
  }

  return (
    <PagedModal
      trackingEventModalType="make-changes"
      close={close}
      header={`Make ${isBandit ? "多臂老虎机" : "实验"}变更`}
      submit={onSubmit}
      cta={cta}
      ctaEnabled={ctaEnabled && canSubmit}
      forceCtaText={!ctaEnabled}
      size="lg"
      step={step}
      setStep={(i) => {
        if (!blockSteps.includes(i)) {
          setStep(i);
        }
      }}
      secondaryCTA={
        step === lastStepNumber ? (
          <div className="col ml-1 pl-0" style={{ minWidth: 520 }}>
            <div className="d-flex m-0 px-2 py-1 alert alert-warning align-items-center">
              <div>
                <strong>警告：</strong> 发布后，所做变更将立即应用于关联的特性标记、可视化变更和URL重定向。
              </div>
              <label
                htmlFor="confirm-changes"
                className="btn btn-sm btn-warning d-flex my-1 ml-1 px-1 d-flex align-items-center justify-content-md-center"
                style={{ height: 35 }}
              >
                <strong className="mr-2 user-select-none text-dark">
                  确认
                </strong>
                <input
                  id="confirm-changes"
                  type="checkbox"
                  checked={changesConfirmed}
                  onChange={(e) => setChangesConfirmed(e.target.checked)}
                />
              </label>
            </div>
          </div>
        ) : undefined
      }
    >
      <Page display="变更类型">
        <div className="px-3 py-2">
          <ChangeTypeSelector
            experiment={experiment}
            changeType={changeType}
            setChangeType={setChangeType}
          />

          <div className="mt-4">
            <label>当前目标定位和流量（仅供参考）</label>
            <div className="appbox bg-light px-3 pt-3 pb-1 mb-0">
              <TargetingInfo
                experiment={experiment}
                noHeader={true}
                targetingFieldsOnly={true}
                separateTrafficSplitDisplay={true}
                showDecimals={true}
                showNamespaceRanges={true}
              />
            </div>
          </div>
        </div>
      </Page>

      {changeType !== "phase" && (
        <Page display="进行变更">
          <div className="px-2">
            <TargetingForm
              experiment={experiment}
              form={form}
              safeToEdit={false}
              changeType={changeType}
              conditionKey={conditionKey}
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
            />
          </div>
        </Page>
      )}

      <Page display="审核与部署">
        <div className="px-3 mt-2">
          <ReleaseChangesForm
            experiment={experiment}
            form={form}
            changeType={changeType}
            releasePlan={releasePlan}
            setReleasePlan={setReleasePlan}
          />
        </div>
      </Page>
    </PagedModal>
  );
}

function ChangeTypeSelector({
  experiment,
  changeType,
  setChangeType,
}: {
  experiment: ExperimentInterfaceStringDates;
  changeType?: ChangeType;
  setChangeType: (changeType: ChangeType) => void;
}) {
  const { namespaces } = useOrgSettings();

  const options: RadioOptions = [
    { label: "开始新阶段", value: "phase" },
    {
      label: "保存组、属性和先决条件目标定位",
      value: "targeting",
    },
    {
      label: "命名空间目标定位",
      value: "namespace",
      disabled: !namespaces?.length,
    },
    { label: "流量百分比", value: "traffic" },
    ...(experiment.type !== "multi-armed-bandit"
      ? [{ label: "变体权重", value: "weights" }]
      : []),
    {
      label: "高级：一次进行多项变更",
      value: "advanced",
      ...(experiment.type !== "multi-armed-bandit"
        ? {
          error: `同时进行多项变更时，可能难以控制每项变更的影响。
          引入实验偏差的风险会增加。请谨慎操作。`,
          errorLevel: "warning",
        }
        : {}),
    },
  ];

  return (
    <div>
      <h5>您想进行什么变更？</h5>
      <div className="mt-3">
        <RadioGroup
          value={changeType || ""}
          setValue={(v: ChangeType) => setChangeType(v)}
          options={options.filter((o) => !o.disabled)}
        />
      </div>
    </div>
  );
}

function TargetingForm({
  experiment,
  form,
  safeToEdit,
  changeType = "advanced",
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  safeToEdit: boolean;
  changeType?: ChangeType;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}) {
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({ label: s.property, value: s.property }));

  // If the current hashAttribute isn't in the list, add it for backwards compatibility
  // this could happen if the hashAttribute has been archived, or removed from the experiment's project after the experiment was creaetd
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const settings = useOrgSettings();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const supportsSQL = datasource?.properties?.queryLanguage === "sql";

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;

  const orgStickyBucketing = !!settings.useStickyBucketing;

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <div className="px-2 pt-2">
      {safeToEdit && (
        <>
          <Field
            label="追踪Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText={
              supportsSQL ? (
                <>
                  该实验的唯一标识符，用于跟踪展示次数和分析结果。将与数据源中的
                  <code>experiment_id</code>列匹配。
                </>
              ) : (
                <>
                  该实验的唯一标识符，用于跟踪展示次数和分析结果。必须与跟踪回调中的实验ID匹配。
                </>
              )
            }
          />
          <SelectField
            containerClassName="flex-1"
            label="基于属性分配变体"
            labelClassName="font-weight-bold"
            options={hashAttributeOptions}
            sort={false}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            helpText={"该实验的全局唯一追踪KEY"}
          />
          <FallbackAttributeSelector
            form={form}
            attributeSchema={attributeSchema}
          />
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
            project={experiment.project}
          />

          {orgStickyBucketing && !isBandit ? (
            <Checkbox
              mt="4"
              size="lg"
              label="禁用粘性分桶"
              description="不为该实验持久化变体分配（覆盖组织设置）"
              value={!!form.watch("disableStickyBucketing")}
              setValue={(v) => {
                form.setValue("disableStickyBucketing", v === true);
              }}
            />
          ) : null}
        </>
      )}

      {(!hasLinkedChanges || safeToEdit) && <hr className="my-4" />}
      {!hasLinkedChanges && (
        <>
          <div className="alert alert-info">
            下方所做的更改仅为元数据更改，除非将由GrowthBook管理的关联特性或可视化变更链接到本实验，否则不会对实际的实验交付产生影响。
          </div>
        </>
      )}

      {["targeting", "advanced"].includes(changeType) && (
        <>
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(v) => form.setValue("savedGroups", v)}
            project={experiment.project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition")}
            onChange={(condition) => form.setValue("condition", condition)}
            key={conditionKey}
            project={experiment.project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={form.watch("prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            environments={envs}
            project={experiment.project}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["namespace", "advanced"].includes(changeType) && (
        <>
          <NamespaceSelector
            form={form}
            featureId={experiment.trackingKey}
            trackingKey={experiment.trackingKey}
          />
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["traffic", "weights", "advanced"].includes(changeType) && (
        <FeatureVariationsInput
          valueType={"string"}
          coverage={form.watch("coverage")}
          setCoverage={(coverage) => form.setValue("coverage", coverage)}
          setWeight={(i, weight) =>
            form.setValue(`variationWeights.${i}`, weight)
          }
          valueAsId={true}
          variations={
            experiment.variations.map((v, i) => {
              return {
                value: v.key || i + "",
                name: v.name,
                weight: form.watch(`variationWeights.${i}`),
                id: v.id,
              };
            }) || []
          }
          showPreview={false}
          disableCoverage={changeType === "weights"}
          disableVariations={changeType === "traffic"}
          hideVariations={type === "multi-armed-bandit"}
          label={
            changeType === "traffic" || type === "multi-armed-bandit"
              ? "流量百分比"
              : changeType === "weights"
                ? "变体权重"
                : "流量百分比与变体权重"
          }
          customSplitOn={true}
        />
      )}
    </div>
  );
}
