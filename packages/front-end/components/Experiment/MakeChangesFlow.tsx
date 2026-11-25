import { UseFormReturn, useWatch } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { areVariationWeightsValid } from "shared/experiments";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { Fragment, ReactNode, useEffect, useState } from "react";
import { Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import useOrgSettings from "@/hooks/useOrgSettings";
import track from "@/services/track";
import { variationWeightsTotalPercent } from "@/services/utils";
import RadioGroup, { RadioOptions } from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import TruncatedText from "@/ui/TruncatedText";
import TargetingForm from "./TargetingForm";

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

export interface MakeChangesFlowProps {
  experiment: ExperimentInterfaceStringDates;
  attributeProjects?: string[] | null;
  form: UseFormReturn<ExperimentTargetingData>;
  // Loosely typed because `useForm` accepts a `DeepPartial<ExperimentTargetingData>`
  // and the namespace shape produced by `EditTargetingModal` doesn't always match
  // the strict `ExperimentTargetingData` shape (legacy vs. multi-range namespaces).
  defaultValues: Record<string, unknown>;
  // Receives the selected change type as the validation scope so the shared
  // submit handler only validates the fields this flow actually rendered.
  onSubmit: (scope?: ChangeType) => Promise<void>;
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
  onSubmit,
  close,
  canSubmit,
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: MakeChangesFlowProps) {
  const { t, i18n } = useLingui();
  const listFormat = new Intl.ListFormat(i18n.locale, { type: "conjunction" });
  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<ChangeType | undefined>();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);

  const isBandit = experiment.type === "multi-armed-bandit";
  // What serves the experiment, so it takes the change once it's published.
  const linkedFlags = experiment.linkedFeatures ?? [];
  const linkedFlagCount = linkedFlags.length;
  const servedBy: ReactNode[] = [
    ...(linkedFlags.length === 1
      ? [
          <Fragment key="flag">
            <Trans>
              the linked Feature Flag{" "}
              <TruncatedText
                weight="semibold"
                maxWidth={240}
                text={linkedFlags[0]}
              />
            </Trans>
          </Fragment>,
        ]
      : linkedFlags.length
        ? [t`the ${linkedFlagCount} linked Feature Flags`]
        : []),
    ...(experiment.hasVisualChangesets
      ? [t`the AI Visual Editor changes`]
      : []),
    ...(experiment.hasURLRedirects ? [t`the URL Redirects`] : []),
  ];
  const servedByList = (
    <>
      {listFormat
        .formatToParts(servedBy.map((_, i) => String(i)))
        .map((part, i) =>
          part.type === "element" ? (
            <Fragment key={i}>{servedBy[Number(part.value)]}</Fragment>
          ) : (
            part.value
          ),
        )}
    </>
  );

  const lastStepNumber = changeType !== "phase" ? 2 : 1;

  // useWatch so that form.setValue calls from NamespaceSelector (a child)
  // trigger a re-render here. Control flags are excluded because they're
  // mutated programmatically by the change-type step, not by the user.
  const watchedValues = useWatch({ control: form.control });
  const pickForCompare = <T extends Record<string, unknown>>(v: T) =>
    omit(v, [
      "newPhase",
      "reseed",
      "bucketVersion",
      "minBucketVersion",
      // Picker view preference — must not arm the publish flow on its own.
      "attributeScopeAllProjects",
    ]);
  const hasChanges = !isEqual(
    pickForCompare(watchedValues),
    pickForCompare(defaultValues),
  );

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

  const submit = async () => {
    await onSubmit(changeType);
    track("edit-experiment-targeting", {
      type: changeType,
      action: releasePlan,
    });
  };

  let cta = t`Publish changes`;
  let ctaEnabled = true;
  let disabledMessage: string | undefined;
  let blockSteps: number[] = [];
  if (!changeType) {
    cta = t`Select a change type`;
    ctaEnabled = false;
    blockSteps = [1, 2];
  } else {
    if (changeType !== "phase" && !hasChanges) {
      if (step === 1) {
        cta = t`No changes`;
        ctaEnabled = false;
      }
      blockSteps = [lastStepNumber];
    }
    if (!releasePlan && step === lastStepNumber) {
      cta = t`Select a release plan`;
      ctaEnabled = false;
    }
    if (step === lastStepNumber && !changesConfirmed) {
      // Only name the confirm gate when it's the sole remaining blocker.
      if (ctaEnabled) disabledMessage = t`Check "Confirm" to publish`;
      ctaEnabled = false;
    }
  }

  return (
    <PagedModal
      trackingEventModalType="make-changes"
      close={close}
      header={isBandit ? t`Make Bandit Changes` : t`Make Experiment Changes`}
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
                  label={t`Confirm`}
                  weight="medium"
                  align="center"
                />
              </Box>
            }
          >
            {servedBy.length ? (
              <Trans>Publishing applies immediately to {servedByList}.</Trans>
            ) : (
              <Trans>Publishing applies immediately.</Trans>
            )}
          </ModalWarningBanner>
        ) : undefined
      }
    >
      <Page display={t`Type of Changes`}>
        <Box py="2">
          <ChangeTypeSelector
            experiment={experiment}
            changeType={changeType}
            setChangeType={setChangeType}
          />

          <Box mt="4">
            <Text as="div" weight="semibold" mb="2">
              <Trans>Current targeting and traffic (for reference)</Trans>
            </Text>
            <TargetingInfo experiment={experiment} />
          </Box>
        </Box>
      </Page>

      {changeType !== "phase" && (
        <Page display={t`Make Changes`}>
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

      <Page display={t`Review & Deploy`}>
        <div className="mt-2">
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
  const { t } = useLingui();
  const { namespaces } = useOrgSettings();

  const weights =
    experiment.phases[experiment.phases.length - 1]?.variationWeights;
  const invalidWeights =
    experiment.type !== "multi-armed-bandit" &&
    !!weights &&
    !areVariationWeightsValid(weights);
  const totalPercent = weights ? variationWeightsTotalPercent(weights) : 0;

  const options: RadioOptions = [
    { label: t`Start a new phase`, value: "phase" },
    {
      label: t`Saved Group, attribute, and prerequisite targeting`,
      value: "targeting",
    },
    {
      label: t`Namespace targeting`,
      value: "namespace",
      disabled: !namespaces?.length,
    },
    { label: t`Traffic percent`, value: "traffic" },
    ...(experiment.type !== "multi-armed-bandit"
      ? [{ label: t`Variation weights`, value: "weights" }]
      : []),
    {
      label: t`Advanced: multiple changes at once`,
      value: "advanced",
      ...(experiment.type !== "multi-armed-bandit"
        ? {
            error: t`When making multiple changes at the same time, it can be difficult to control for the impact of each change. 
              The risk of introducing experimental bias increases. Proceed with caution.`,
            errorLevel: "warning",
          }
        : {}),
    },
  ];

  return (
    <div>
      {invalidWeights && (
        <Callout status="warning" mb="4">
          <Trans>
            The current variation weights add up to {totalPercent}%, so SDKs
            ignore them and split traffic equally. Fix the weights to make other
            changes.
          </Trans>
        </Callout>
      )}
      <h5>
        <Trans>What do you want to change?</Trans>
      </h5>
      <div className="mt-3">
        <RadioGroup
          value={changeType || ""}
          setValue={(v: ChangeType) => setChangeType(v)}
          options={options
            .filter((o) => !o.disabled)
            .map((o) =>
              !invalidWeights || ["weights", "advanced"].includes(o.value)
                ? o
                : {
                    ...o,
                    disabled: true,
                    disabledReason: t`Fix the variation weights first.`,
                  },
            )}
        />
      </div>
    </div>
  );
}
