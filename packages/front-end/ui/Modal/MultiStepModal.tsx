import { Box, Flex } from "@radix-ui/themes";
import {
  Children,
  createContext,
  FC,
  isValidElement,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PiArrowLeft, PiCaretRight } from "react-icons/pi";
import Stepper from "@/components/Stepper/Stepper";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
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
// Composability lives at the STEP level: a <MultiStepModal.Root> wraps an
// ordered list of <MultiStepModal.Step> children, one per page. Everything
// else — the frame, the Stepper, the Back / Cancel / Next|CTA footer, dismiss
// behavior — is owned by Root and locked to one consistent behavior, so every
// wizard in the app looks and behaves the same. Per-page variance (label,
// validation, whether Next is enabled) is declared on each Step.
//
// The footer buttons are deliberately NOT composable: the primary button
// carries the flow's behavior (validate, advance or submit, spinner,
// auto-close), so handing it to consumers would break those invariants and let
// footers drift. Reuses Modal.Root's sizes (md | lg | xl | fill) unchanged.
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
  // Runs before leaving this step going forward — on Next, on a Stepper click
  // that jumps past it, and as part of the sweep on final submit. Throw to
  // block navigation: the modal snaps to the first step whose validator throws
  // (derived from the validator's position, not the error) and shows the
  // message. Keep validators cheap and idempotent — anything expensive/async
  // re-runs on each forward move, so make re-running harmless or reserve it for
  // the last step, where it only runs on submit.
  validate?: () => Promise<void>;
  // Gates the primary (Next / final CTA) button while this step is active.
  // Defaults to true.
  nextEnabled?: boolean;
  // Tooltip shown on the disabled primary button when nextEnabled is false.
  disabledMessage?: string;
  children: ReactNode;
};

// Step is a declarative marker. Root reads its props and renders the active
// step's children itself, so Step never renders on its own.
const Step: FC<StepProps> = () => null;

type StepMeta = {
  display: string;
  enabled: boolean;
  validate?: () => Promise<void>;
  nextEnabled: boolean;
  disabledMessage?: string;
};

// ---------------------------------------------------------------------------
// Navigation context.
//
// Opt-in escape hatch for step content that needs to move the flow
// programmatically — e.g. a "go back and edit" link in a later page, or a
// field change in an early page that should restart the flow. Most wizards
// never touch it; they rely on the footer + validate. Exposing navigation
// this way (rather than controlled step/setStep props on Root) keeps Root's
// surface small and keeps the validate-on-forward invariant enforced in one
// place.
// ---------------------------------------------------------------------------

type MultiStepModalNav = {
  step: number;
  stepCount: number;
  goToStep: (step: number) => void;
  next: () => void;
  back: () => void;
};

const NavContext = createContext<MultiStepModalNav | null>(null);

export function useMultiStepModal(): MultiStepModalNav {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error(
      "useMultiStepModal must be called inside a <MultiStepModal.Root>.",
    );
  }
  return ctx;
}

export type RootProps = TrackingEventModalProps & {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: Size;
  // Final-step CTA label. Intermediate steps always show "Next".
  cta?: string;
  // Called once, on the final step, after every step validates. Advancing
  // between steps does not call this. The modal closes on success.
  submit: () => void | Promise<void>;
  // Step index to open on. Uncontrolled after mount — the modal owns the step
  // from there (see useMultiStepModal for programmatic navigation).
  initialStep?: number;
  children: ReactNode;
};

function Root({
  open,
  onClose,
  title,
  size = "md",
  cta = "Save",
  submit,
  initialStep = 0,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  children,
}: RootProps) {
  const [step, setStep] = useState(initialStep);

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
      nextEnabled: props.nextEnabled !== false,
      disabledMessage: props.disabledMessage,
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
  const current = steps[step];

  // Validate every enabled step before `before`, snapping to the first that
  // fails so the user lands on the problem. The failing step is the index the
  // loop is on, not anything the error carries.
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
      await submit();
      onClose();
      return;
    }
    // Validate everything up to (and therefore including) the current step
    // before advancing.
    await validateSteps(nextStep);
    if (nextStep !== undefined) setStep(nextStep);
  };

  const stepperSteps = steps.map(({ display, enabled }) => ({
    label: display,
    enabled,
  }));

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      size={size}
      dismissible={false}
      hasDescription={false}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      <ModalForm onSubmit={handlePrimary} trackOnSubmit={isLastStep}>
        <Content
          title={title}
          step={step}
          setStep={setStep}
          stepperSteps={stepperSteps}
          stepCount={steps.length}
          validateSteps={validateSteps}
          content={content}
          onClose={onClose}
          showBack={prevStep !== undefined}
          onBack={() => {
            if (prevStep !== undefined) setStep(prevStep);
          }}
          cta={isLastStep ? cta : "Next"}
          isLastStep={isLastStep}
          nextEnabled={current?.nextEnabled ?? true}
          disabledMessage={current?.disabledMessage}
        />
      </ModalForm>
    </Modal.Root>
  );
}

// The primary button reads pending state from the enclosing ModalForm, so Next
// and the final CTA both show a spinner while validation/submit runs. When
// disabled with a message, it is wrapped in a Tooltip explaining why.
function PrimaryButton({
  cta,
  isLastStep,
  nextEnabled,
  disabledMessage,
}: {
  cta: string;
  isLastStep: boolean;
  nextEnabled: boolean;
  disabledMessage?: string;
}) {
  const { loading } = useModalForm();
  const button = (
    <Button
      type="submit"
      disabled={!nextEnabled}
      loading={loading}
      icon={isLastStep ? undefined : <PiCaretRight />}
      iconPosition="right"
    >
      {cta}
    </Button>
  );
  if (!nextEnabled && disabledMessage) {
    // Wrap in a span so the tooltip still triggers while the button is
    // disabled (a disabled button does not emit pointer events itself).
    return (
      <Tooltip content={disabledMessage}>
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}

// Rendered inside Modal.Root (and ModalForm) so it can read the Modal context:
// setError feeds Stepper navigation errors into Modal.Body's ErrorDisplay, and
// sendTrackingEvent records page changes. Also provides the navigation context
// to step content via useMultiStepModal.
function Content({
  title,
  step,
  setStep,
  stepperSteps,
  stepCount,
  validateSteps,
  content,
  onClose,
  showBack,
  onBack,
  cta,
  isLastStep,
  nextEnabled,
  disabledMessage,
}: {
  title: string;
  step: number;
  setStep: (step: number) => void;
  stepperSteps: { label: string; enabled: boolean }[];
  stepCount: number;
  validateSteps: (before?: number) => Promise<void>;
  content: ReactNode;
  onClose: () => void;
  showBack: boolean;
  onBack: () => void;
  cta: string;
  isLastStep: boolean;
  nextEnabled: boolean;
  disabledMessage?: string;
}) {
  const { setError, sendTrackingEvent } = useModalContext();

  useEffect(() => {
    sendTrackingEvent("modal-page-change", {
      step: step + 1,
      steps: stepCount,
      pageName: stepperSteps[step]?.label,
    });
    // Fire only on step change, matching the legacy PagedModal behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // goToStep runs the same validate-forward sweep as a Stepper click, so
  // programmatic navigation can never skip validation. Backward moves are free.
  // next/back mirror the footer: they skip disabled steps and no-op at the ends.
  const nav = useMemo<MultiStepModalNav>(() => {
    const goToStep = async (target: number) => {
      if (target < 0 || target >= stepCount) return;
      setError(null);
      try {
        if (target > step) await validateSteps(target);
        setStep(target);
      } catch (e) {
        setError(e.message);
      }
    };
    const nextEnabledFrom = (from: number, dir: 1 | -1) => {
      for (let i = from + dir; i >= 0 && i < stepCount; i += dir) {
        if (stepperSteps[i]?.enabled) return i;
      }
      return from;
    };
    return {
      step,
      stepCount,
      goToStep,
      next: () => goToStep(nextEnabledFrom(step, 1)),
      back: () => goToStep(nextEnabledFrom(step, -1)),
    };
  }, [step, stepCount, stepperSteps, setError, validateSteps, setStep]);

  return (
    <NavContext.Provider value={nav}>
      <Modal.Header>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      {/* The Stepper communicates progress at the top of the modal, in the
          description region. It renders its own nav markup, so it lives in a
          plain Box rather than Modal.Description (a <p>, which cannot legally
          contain the interactive Stepper). */}
      <Box pr="7" mt="4">
        <Stepper
          step={step}
          setStep={setStep}
          steps={stepperSteps}
          setError={setError}
          validateSteps={validateSteps}
        />
      </Box>
      <Modal.Body>{content}</Modal.Body>
      <Modal.Footer justify={showBack ? "between" : "end"}>
        {showBack ? (
          <Button variant="ghost" icon={<PiArrowLeft />} onClick={onBack}>
            Back
          </Button>
        ) : null}
        <Flex gap="3" align="center">
          <Modal.Close>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </Modal.Close>
          <PrimaryButton
            cta={cta}
            isLastStep={isLastStep}
            nextEnabled={nextEnabled}
            disabledMessage={disabledMessage}
          />
        </Flex>
      </Modal.Footer>
    </NavContext.Provider>
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
