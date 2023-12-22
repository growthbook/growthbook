import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import React, { useEffect, useState } from "react";
import { BsToggles } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { getEqualWeights } from "@/services/utils";
import { useAttributeSchema } from "@/services/features";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import useOrgSettings from "@/hooks/useOrgSettings";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SelectField from "../Forms/SelectField";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "../Features/SavedGroupTargetingField";
import HashVersionSelector from "./HashVersionSelector";

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
  | "advanced"
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

  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<ChangeType | undefined>();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const lastStepNumber = changeType !== "phase" ? 2 : 1;

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    hashVersion: experiment.hashVersion || 2,
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

    await apiCall(`/experiment/${experiment.id}/targeting`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
  });

  if (safeToEdit) {
    return (
      <Modal
        open={true}
        close={close}
        header={`Edit Targeting`}
        submit={onSubmit}
        cta="Save"
        size="lg"
      >
        <TargetingForm experiment={experiment} form={form} safeToEdit={true} />
      </Modal>
    );
  }

  let cta = "Publish changes";
  let ctaEnabled = true;
  let blockSteps: number[] = [];
  if (!changeType) {
    cta = "Select a change type";
    ctaEnabled = false;
    blockSteps = [1, 2];
  }
  if (changeType !== "phase" && !hasChanges) {
    if (step === 1) {
      cta = "No changes";
      ctaEnabled = false;
    }
    blockSteps = [lastStepNumber];
  }
  if (!releasePlan && step === lastStepNumber) {
    cta = "Select a release plan";
    ctaEnabled = false;
  }
  if (step == lastStepNumber && !changesConfirmed) {
    ctaEnabled = false;
  }

  return (
    <PagedModal
      close={close}
      header="Make Experiment Changes"
      submit={onSubmit}
      cta={cta}
      ctaEnabled={ctaEnabled}
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
          <div className="col">
            <div className="d-flex m-0 px-3 py-1 alert alert-warning small">
              <div>
                <strong>
                  Warning: Experiment is{" "}
                  {experiment.status === "running" ? "running" : "live"}.
                </strong>{" "}
                Changes made will apply to all linked Feature Flags and Visual
                Editor changes immediately upon publishing.
              </div>
              <label
                htmlFor="confirm-changes"
                className="border-left d-flex py-1 m-0 pl-3 ml-1 cursor-pointer d-flex align-items-center justify-content-md-center"
              >
                <strong className="mr-2 user-select-none">Confirm</strong>
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
      <Page display="Type of Changes">
        <div className="px-3 py-2">
          <ChangeTypeSelector
            changeType={changeType}
            setChangeType={setChangeType}
          />

          {changeType === "advanced" && (
            <div className="alert alert-warning px-3 py-2 small">
              <FaExclamationCircle /> When making multiple types of changes, it
              can be difficult to control for the impact of each change. Proceed
              with caution.
            </div>
          )}

          <div className="mt-4">
            <label>Current targeting</label>
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
        <Page display="Edit Targeting">
          <div className="px-2">
            <TargetingForm
              experiment={experiment}
              form={form}
              safeToEdit={false}
              changeType={changeType}
            />
          </div>
        </Page>
      )}

      <Page display="Review & Deploy">
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
  changeType,
  setChangeType,
}: {
  changeType?: ChangeType;
  setChangeType: (changeType: ChangeType) => void;
}) {
  return (
    <SelectField
      label="What changes do you want to make?"
      value={changeType || ""}
      options={[
        {
          label: "Targeting & Traffic",
          options: [
            { label: "Saved Groups & Attributes", value: "targeting" },
            { label: "Traffic Percent", value: "traffic" },
            { label: "Variation Weights", value: "weights" },
            { label: "Namespace", value: "namespace" },
            { label: "Advanced", value: "advanced" },
          ],
        },
        {
          label: "Phase",
          options: [{ label: "Start a new phase...", value: "phase" }],
        },
      ]}
      onChange={(v) => setChangeType(v as ChangeType)}
      sort={false}
      isSearchable={false}
      formatOptionLabel={({ value, label }) => {
        if (value === "advanced") {
          return (
            <>
              <span className="ml-2 font-italic">
                <BsToggles className="position-relative" style={{ top: -1 }} />{" "}
                {label}
              </span>
              <span className="ml-2">
                &mdash; Make multiple targeting changes at the same time
              </span>
            </>
          );
        }
        return <span className="ml-2">{label}</span>;
      }}
    />
  );
}

function TargetingForm({
  experiment,
  form,
  safeToEdit = false,
  changeType = "advanced",
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  safeToEdit?: boolean;
  changeType?: ChangeType;
}) {
  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const settings = useOrgSettings();
  const orgStickyBucketing = settings.useStickyBucketing;

  return (
    <div className="px-2 pt-2">
      {safeToEdit && (
        <>
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <div className="d-flex" style={{ gap: "2rem" }}>
            <SelectField
              containerClassName="flex-1"
              label="Assign variation based on attribute"
              labelClassName="font-weight-bold"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              sort={false}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "Will be hashed together with the Tracking Key to determine which variation to assign"
              }
            />
            <SelectField
              containerClassName="flex-1"
              label="Fallback attribute"
              labelClassName="font-weight-bold"
              options={[
                { label: "none", value: "" },
                ...attributeSchema
                  .filter((s) => !hasHashAttributes || s.hashAttribute)
                  .map((s) => ({ label: s.property, value: s.property })),
              ]}
              formatOptionLabel={({ value, label }) => {
                if (!value) {
                  return <em className="text-muted">{label}</em>;
                }
                return label;
              }}
              sort={false}
              value={
                orgStickyBucketing ? form.watch("fallbackAttribute") || "" : ""
              }
              onChange={(v) => {
                form.setValue("fallbackAttribute", v);
              }}
              helpText={
                <>
                  <div>
                    If the user&apos;s assignment attribute is not available the
                    fallback attribute may be used instead.
                  </div>
                  {!orgStickyBucketing && (
                    <div className="text-warning-orange mt-1">
                      <FaInfoCircle /> Sticky bucketing is currently disabled
                      for your organization.
                    </div>
                  )}
                </>
              }
              disabled={!orgStickyBucketing}
            />
          </div>
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
          />
        </>
      )}
      {["targeting", "advanced"].includes(changeType) && (
        <>
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(v) => form.setValue("savedGroups", v)}
          />
          <ConditionInput
            defaultValue={form.watch("condition")}
            onChange={(condition) => form.setValue("condition", condition)}
          />
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
          label={
            changeType === "traffic"
              ? "Traffic Percentage"
              : changeType === "weights"
              ? "Variation Weights"
              : "Traffic Percentage & Variation Weights"
          }
        />
      )}
      {["namespace", "advanced"].includes(changeType) && (
        <NamespaceSelector
          form={form}
          featureId={experiment.trackingKey}
          trackingKey={experiment.trackingKey}
        />
      )}
    </div>
  );
}
