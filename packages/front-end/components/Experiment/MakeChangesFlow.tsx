import { UseFormReturn, useWatch } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import {
  ChangeAssessment,
  ExperimentChangeType,
  postExperimentChangesValidator,
  ReleasePlan,
} from "shared/validators";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { useEffect, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import useOrgSettings from "@/hooks/useOrgSettings";
import track from "@/services/track";
import { RestApiError, useRestApiCall } from "@/services/restApi";
import RadioGroup, { RadioOptions } from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import TargetingForm from "./TargetingForm";
import { buildMakeChangesBody } from "./makeChangesRequest";

export interface MakeChangesFlowProps {
  experiment: ExperimentInterfaceStringDates;
  attributeProjects?: string[] | null;
  form: UseFormReturn<ExperimentTargetingData>;
  // Loosely typed because `useForm` accepts a `DeepPartial<ExperimentTargetingData>`
  // and the namespace shape produced by `EditTargetingModal` doesn't always match
  // the strict `ExperimentTargetingData` shape (legacy vs. multi-range namespaces).
  defaultValues: Record<string, unknown>;
  // Client-side checks, scoped to the fields the selected change type renders.
  validate: (
    value: ExperimentTargetingData,
    scope?: ExperimentChangeType,
  ) => ExperimentTargetingData;
  mutate: () => void;
  close: () => void;
  canSubmit: boolean;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function MakeChangesFlow({
  experiment,
  attributeProjects,
  form,
  defaultValues,
  validate,
  mutate,
  close,
  canSubmit,
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: MakeChangesFlowProps) {
  const restApiCall = useRestApiCall();
  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<
    ExperimentChangeType | undefined
  >();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);
  const [assessment, setAssessment] = useState<ChangeAssessment | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);

  const isBandit = experiment.type === "multi-armed-bandit";

  const lastStepNumber = changeType !== "new-phase" ? 2 : 1;
  const onReviewStep = !!changeType && step === lastStepNumber;

  // useWatch so that form.setValue calls from NamespaceSelector (a child)
  // trigger a re-render here.
  const watchedValues = useWatch({ control: form.control });
  // Picker view preference — must not arm the publish flow on its own.
  const pickForCompare = <T extends Record<string, unknown>>(v: T) =>
    omit(v, ["attributeScopeAllProjects"]);
  const hasChanges = !isEqual(
    pickForCompare(watchedValues),
    pickForCompare(defaultValues),
  );

  const requestBody = (values: ExperimentTargetingData) =>
    changeType
      ? buildMakeChangesBody({
          experiment,
          changeType,
          values,
          defaults: defaultValues as Partial<ExperimentTargetingData>,
        })
      : null;

  // Review & Deploy shows the server's assessment of exactly this request.
  const reviewKey = onReviewStep
    ? JSON.stringify(requestBody(watchedValues as ExperimentTargetingData))
    : null;

  useEffect(() => {
    if (changeType !== "advanced") {
      form.reset();
    }
  }, [changeType, form]);

  useEffect(() => {
    if (step !== lastStepNumber) {
      setReleasePlan(undefined);
      setChangesConfirmed(false);
    }
  }, [changeType, step, lastStepNumber]);

  // The parent rebuilds `validate` every render; read the latest one without
  // re-running the preview.
  const validateRef = useRef(validate);
  useEffect(() => {
    validateRef.current = validate;
  });

  useEffect(() => {
    setAssessment(null);
    setAssessmentError(null);
    if (!reviewKey) return;
    let cancelled = false;
    (async () => {
      try {
        validateRef.current(structuredClone(form.getValues()), changeType);
        // Custom-hook warnings surface on publish, as before; skipping them
        // here lets the preview show the plans.
        const res = await restApiCall(postExperimentChangesValidator, {
          params: { id: experiment.id },
          body: {
            ...JSON.parse(reviewKey),
            dryRun: true,
            ignoreWarnings: true,
          },
        });
        if (!cancelled) setAssessment(res.assessment);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof RestApiError && e.code === "release_plan_required") {
          setAssessment(e.details as ChangeAssessment);
        } else {
          setAssessmentError(e.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewKey, changeType, experiment.id, form, restApiCall]);

  // Preselect the recommended plan; keep the user's pick while it's available.
  useEffect(() => {
    if (!assessment) return;
    setReleasePlan((current) =>
      current &&
      assessment.releasePlans.some((p) => p.plan === current && p.available)
        ? current
        : assessment.recommendedReleasePlan,
    );
  }, [assessment]);

  const submit = async () => {
    if (!changeType || !releasePlan) return;
    const values = validate(structuredClone(form.getValues()), changeType);
    const body = requestBody(values);
    if (!body) return;
    await restApiCall(postExperimentChangesValidator, {
      params: { id: experiment.id },
      body: { ...body, releasePlan },
    });
    mutate();
    track("edit-experiment-targeting", {
      type: changeType,
      action: releasePlan,
    });
  };

  let cta = "Publish changes";
  let ctaEnabled = true;
  let disabledMessage: string | undefined;
  let blockSteps: number[] = [];
  if (!changeType) {
    cta = "Select a change type";
    ctaEnabled = false;
    blockSteps = [1, 2];
  } else {
    if (changeType !== "new-phase" && !hasChanges) {
      if (step === 1) {
        cta = "No changes";
        ctaEnabled = false;
      }
      blockSteps = [lastStepNumber];
    }
    if (onReviewStep && !assessment) {
      cta = assessmentError ? "Can't publish" : "Reviewing changes...";
      ctaEnabled = false;
    } else if (!releasePlan && onReviewStep) {
      cta = "Select a release plan";
      ctaEnabled = false;
    }
    if (onReviewStep && !changesConfirmed) {
      // Only name the confirm gate when it's the sole remaining blocker.
      if (ctaEnabled) disabledMessage = 'Check "Confirm" to publish';
      ctaEnabled = false;
    }
  }

  return (
    <PagedModal
      trackingEventModalType="make-changes"
      close={close}
      header={`Make ${isBandit ? "Bandit" : "Experiment"} Changes`}
      submit={submit}
      cta={cta}
      ctaEnabled={ctaEnabled && canSubmit}
      disabledMessage={disabledMessage}
      forceCtaText={!ctaEnabled}
      size="lg"
      step={step}
      setStep={(i) => {
        if (!blockSteps.includes(i)) {
          setStep(i);
        }
      }}
      aboveFooterContent={
        step === lastStepNumber ? (
          <ModalWarningBanner
            controls={
              <Box style={{ color: "var(--violet-11)" }}>
                <Checkbox
                  value={changesConfirmed}
                  setValue={setChangesConfirmed}
                  label="Confirm"
                  weight="medium"
                  align="center"
                />
              </Box>
            }
          >
            Changes made will apply to linked Feature Flags, Visual Changes, and
            URL Redirects immediately upon publishing.
          </ModalWarningBanner>
        ) : undefined
      }
    >
      <Page display="Type of Changes">
        <div className="py-2">
          <ChangeTypeSelector
            experiment={experiment}
            changeType={changeType}
            setChangeType={setChangeType}
          />

          <div className="mt-4">
            <label>Current targeting and traffic (for reference)</label>
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

      {changeType !== "new-phase" && (
        <Page display="Make Changes">
          <div>
            <TargetingForm
              experiment={experiment}
              attributeProjects={attributeProjects}
              form={form}
              changeType={changeType}
              conditionKey={conditionKey}
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
            />
          </div>
        </Page>
      )}

      <Page display="Review & Deploy">
        <div className="mt-2">
          <ReleaseChangesForm
            experiment={experiment}
            form={form}
            changeType={changeType}
            assessment={assessment}
            assessmentError={assessmentError}
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
  changeType?: ExperimentChangeType;
  setChangeType: (changeType: ExperimentChangeType) => void;
}) {
  const { namespaces } = useOrgSettings();

  const options: RadioOptions = [
    { label: "Start a New Phase", value: "new-phase" },
    {
      label: "Saved Group, Attribute, and Prerequisite Targeting",
      value: "targeting",
    },
    {
      label: "Namespace Targeting",
      value: "namespace",
      disabled: !namespaces?.length,
    },
    { label: "Traffic Percent", value: "coverage" },
    ...(experiment.type !== "multi-armed-bandit"
      ? [{ label: "Variation Weights", value: "weights" }]
      : []),
    {
      label: "Advanced: multiple changes at once",
      value: "advanced",
      ...(experiment.type !== "multi-armed-bandit"
        ? {
            error: `When making multiple changes at the same time, it can be difficult to control for the impact of each change.
              The risk of introducing experimental bias increases. Proceed with caution.`,
            errorLevel: "warning",
          }
        : {}),
    },
  ];

  return (
    <div>
      <h5>What do you want to change?</h5>
      <div className="mt-3">
        <RadioGroup
          value={changeType || ""}
          setValue={(v: ExperimentChangeType) => setChangeType(v)}
          options={options.filter((o) => !o.disabled)}
        />
      </div>
    </div>
  );
}
