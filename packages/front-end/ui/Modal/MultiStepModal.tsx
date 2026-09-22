import { Box, Flex } from "@radix-ui/themes";
import {
  Children,
  FC,
  isValidElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import { PiArrowLeft, PiCaretRight } from "react-icons/pi";
import Stepper from "@/components/Stepper/Stepper";
import Button from "@/ui/Button";
import Modal, {
  Size,
  TrackingEventModalProps,
  useModalContext,
} from "@/ui/Modal";
import ModalForm, { useModalForm } from "./ModalForm";

// ---------------------------------------------------------------------------
// MultiStepModal — a multi-page ("wizard") modal built on the composable
// Modal primitives.
//
// It is composed the same way the underlying Modal is: a <MultiStepModal.Root>
// wraps an ordered list of <MultiStepModal.Step> children. Each Step declares
// its label and (optionally) a validator; Root renders the Stepper for
// progress, the active step's content in the scrollable body, and a footer
// that walks Back / Next and turns into the final CTA on the last step. It
// reuses Modal.Root's sizes (md | lg | xl | fill) unchanged.
//
// For a single-page modal reach for <Modal.Root> primitives or the
// ModalStandard pattern instead.
// ---------------------------------------------------------------------------

export type StepProps = {
  // The label shown in the Stepper for this step.
  display: string;
  // A disabled step is skipped when walking Next/Back and is not clickable in
  // the Stepper. Defaults to true.
  enabled?: boolean;
  // Runs before leaving this step (via Next or a Stepper click that jumps past
  // it). Throw to block navigation and surface the error at the top of the
  // body — the Stepper snaps back to the offending step.
  validate?: () => Promise<void>;
  // Replaces the default "advance to the next step" behavior of Next. Use when
  // moving forward means something other than incrementing the step (e.g. the
  // step owns its own sub-flow).
  customNext?: () => void;
  children: ReactNode;
};

// Step is a declarative marker. Root reads its props and renders the active
// step's children itself, so Step never renders on its own.
const Step: FC<StepProps> = () => null;

type StepMeta = {
  display: string;
  enabled: boolean;
  validate?: () => Promise<void>;
  customNext?: () => void;
};

export type RootProps = TrackingEventModalProps & {
  open: boolean;
  header: ReactNode;
  // Optional element rendered on the right of the header row (e.g. an
  // environment Select), matching Modal.Header's space-between layout.
  headerAction?: ReactNode;
  // Optional descriptive text rendered under the Stepper.
  description?: ReactNode;
  size?: Size;
  // Controlled step index. Omit both to let the modal track the step itself.
  step?: number;
  setStep?: (step: number) => void;
  // Called once, on the final step, after all steps validate. Advancing
  // between steps does not call this.
  submit?: () => void | Promise<void>;
  close: () => void;
  // Final-step CTA label. Intermediate steps always show "Next".
  cta?: string;
  ctaColor?: "red" | "violet";
  ctaEnabled?: boolean;
  closeCta?: string;
  autoCloseOnSubmit?: boolean;
  dismissible?: boolean;
  // Shows a Back button in the footer. On the first step it calls
  // onBackFirstStep when provided; otherwise Back is hidden there.
  backButton?: boolean;
  onBackFirstStep?: () => void;
  // Optional element on the left of the footer, for out-of-flow actions.
  secondaryAction?: ReactNode;
  // Renders a Skip button on the left of the footer.
  onSkip?: () => void | Promise<void>;
  // Steps the user skipped, rendered with a dashed marker in the Stepper.
  skipped?: Set<number>;
  hideStepper?: boolean;
  trackOnSubmit?: boolean;
  children: ReactNode;
};

function Root({
  open,
  header,
  headerAction,
  description,
  size = "md",
  step: controlledStep,
  setStep: controlledSetStep,
  submit,
  close,
  cta = "Save",
  ctaColor = "violet",
  ctaEnabled = true,
  closeCta = "Cancel",
  autoCloseOnSubmit = true,
  dismissible = false,
  backButton = false,
  onBackFirstStep,
  secondaryAction,
  onSkip,
  skipped,
  hideStepper = false,
  trackOnSubmit = true,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  children,
}: RootProps) {
  const [internalStep, setInternalStep] = useState(0);
  const step = controlledStep ?? internalStep;
  const setStep = controlledSetStep ?? setInternalStep;

  // Parse the ordered Step children into metadata + the active step's content.
  const steps: StepMeta[] = [];
  let content: ReactNode = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as StepProps;
    if (steps.length === step) content = props.children;
    steps.push({
      display: props.display,
      enabled: props.enabled !== false,
      validate: props.validate,
      customNext: props.customNext,
    });
  });

  // Next / previous enabled step, skipping any disabled steps between them.
  let nextStep: number | undefined;
  for (let i = step + 1; i < steps.length; i++) {
    if (steps[i].enabled) {
      nextStep = i;
      break;
    }
  }
  let prevStep: number | undefined;
  for (let i = step - 1; i >= 0; i--) {
    if (steps[i].enabled) {
      prevStep = i;
      break;
    }
  }
  const isLastStep = nextStep === undefined;

  // Validate every enabled step before `before`, snapping to the first that
  // fails so the user lands on the problem.
  async function validateSteps(before: number = steps.length) {
    for (let i = 0; i < before; i++) {
      if (!steps[i].enabled) continue;
      try {
        await steps[i].validate?.();
      } catch (e) {
        setStep(i);
        throw e;
      }
    }
  }

  const handlePrimary = async () => {
    if (isLastStep) {
      await validateSteps();
      await submit?.();
      if (autoCloseOnSubmit) close();
      return;
    }
    // Validate everything up to (and therefore including) the current step
    // before advancing.
    await validateSteps(nextStep);
    const current = steps[step];
    if (current.customNext) {
      current.customNext();
    } else if (nextStep !== undefined) {
      setStep(nextStep);
    }
  };

  const stepperSteps = steps.map(({ display, enabled }) => ({
    label: display,
    enabled,
  }));

  const showBack =
    backButton && (prevStep !== undefined || step > 0 || !!onBackFirstStep);
  const hasLeftFooter = showBack || !!secondaryAction || !!onSkip;

  const leftFooter = (
    <Flex gap="3" align="center">
      {showBack && (
        <Button
          variant="ghost"
          icon={<PiArrowLeft />}
          onClick={() => {
            if (step <= 0 && onBackFirstStep) {
              onBackFirstStep();
            } else {
              setStep(prevStep ?? 0);
            }
          }}
        >
          Back
        </Button>
      )}
      {secondaryAction}
      {onSkip && (
        <Button variant="ghost" onClick={() => onSkip()}>
          Skip
        </Button>
      )}
    </Flex>
  );

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size={size}
      dismissible={dismissible}
      hasDescription={!!description}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      <ModalForm
        onSubmit={handlePrimary}
        // Only the final step is a real submit; intermediate "Next" clicks
        // should not fire submit-success/error tracking.
        trackOnSubmit={trackOnSubmit && isLastStep}
      >
        <Content
          header={header}
          headerAction={headerAction}
          description={description}
          hideStepper={hideStepper}
          step={step}
          setStep={setStep}
          stepperSteps={stepperSteps}
          validateSteps={validateSteps}
          skipped={skipped}
          content={content}
          footer={
            <Modal.Footer justify={hasLeftFooter ? "between" : "end"}>
              {hasLeftFooter ? leftFooter : null}
              <Flex gap="3" align="center">
                <Modal.Close>
                  <Button variant="ghost" onClick={close}>
                    {closeCta}
                  </Button>
                </Modal.Close>
                <PrimaryButton
                  isLastStep={isLastStep}
                  cta={cta}
                  ctaColor={ctaColor}
                  ctaEnabled={ctaEnabled}
                />
              </Flex>
            </Modal.Footer>
          }
        />
      </ModalForm>
    </Modal.Root>
  );
}

// The submit button reads pending state from the enclosing ModalForm, so Next
// and the final CTA both show a spinner while validation/submit runs.
function PrimaryButton({
  isLastStep,
  cta,
  ctaColor,
  ctaEnabled,
}: {
  isLastStep: boolean;
  cta: string;
  ctaColor: "red" | "violet";
  ctaEnabled: boolean;
}) {
  const { loading } = useModalForm();
  return (
    <Button
      type="submit"
      color={ctaColor}
      disabled={!ctaEnabled}
      loading={loading}
      icon={isLastStep ? undefined : <PiCaretRight />}
      iconPosition="right"
    >
      {isLastStep ? cta : "Next"}
    </Button>
  );
}

// Rendered inside Modal.Root (and ModalForm) so it can read the Modal context:
// setError feeds Stepper navigation errors into Modal.Body's ErrorDisplay, and
// sendTrackingEvent records page changes.
function Content({
  header,
  headerAction,
  description,
  hideStepper,
  step,
  setStep,
  stepperSteps,
  validateSteps,
  skipped,
  content,
  footer,
}: {
  header: ReactNode;
  headerAction?: ReactNode;
  description?: ReactNode;
  hideStepper: boolean;
  step: number;
  setStep: (step: number) => void;
  stepperSteps: { label: string; enabled: boolean }[];
  validateSteps: (before?: number) => Promise<void>;
  skipped?: Set<number>;
  content: ReactNode;
  footer: ReactNode;
}) {
  const { setError, sendTrackingEvent } = useModalContext();

  useEffect(() => {
    sendTrackingEvent("modal-page-change", {
      step: step + 1,
      steps: stepperSteps.length,
      pageName: stepperSteps[step]?.label,
    });
    // Fire only on step change, matching the legacy PagedModal behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <>
      <Modal.Header>
        <Modal.Title>{header}</Modal.Title>
        {headerAction ? <Box>{headerAction}</Box> : null}
      </Modal.Header>
      {/* The Stepper communicates progress at the top of the modal, in the
          description region. It renders its own nav markup, so it lives in a
          plain Box rather than Modal.Description (a <p>, which cannot legally
          contain the interactive Stepper). */}
      {!hideStepper && (
        <Box pr="7" mt="4">
          <Stepper
            step={step}
            setStep={setStep}
            steps={stepperSteps}
            setError={setError}
            skipped={skipped}
            validateSteps={validateSteps}
          />
        </Box>
      )}
      {description ? (
        <Modal.Description>{description}</Modal.Description>
      ) : null}
      <Modal.Body>{content}</Modal.Body>
      {footer}
    </>
  );
}

// ---------------------------------------------------------------------------
// Namespace export, mirroring Modal: <MultiStepModal.Root> with one
// <MultiStepModal.Step> per page.
// ---------------------------------------------------------------------------

const MultiStepModal = {
  Root,
  Step,
};

export default MultiStepModal;
