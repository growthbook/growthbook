import { Box, Dialog, Flex, VisuallyHidden } from "@radix-ui/themes";
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { PiArrowLeft, PiCaretRight } from "react-icons/pi";
import StepperNav from "@/components/Stepper/Stepper";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Modal, {
  Size,
  TrackingEventModalProps,
  useModalContext,
} from "@/ui/Modal";
import ModalForm, { useModalForm } from "./ModalForm";

// ---------------------------------------------------------------------------
// MultiStepModal — composable primitives for multi-page ("wizard") modals,
// built on the Modal primitives.
//
// Like Modal, this is a set of parts the consumer arranges:
//
//   <MultiStepModal.Root open onOpenChange onSubmit trackingEventModalType>
//     <Modal.Header><Modal.Title>…</Modal.Title></Modal.Header>
//     <MultiStepModal.Stepper />
//     <MultiStepModal.Step label="…"><Modal.Body>…</Modal.Body></MultiStepModal.Step>
//     <MultiStepModal.Step label="…"><Modal.Body>…</Modal.Body></MultiStepModal.Step>
//     <MultiStepModal.Done><Modal.Body>…</Modal.Body></MultiStepModal.Done>
//     <MultiStepModal.Footer submitLabel="Create" />
//   </MultiStepModal.Root>
//
// Layout is the consumer's; behavior lives in the parts. Next validates and
// advances, Back skips disabled steps, and the Stepper and
// useMultiStepModal() navigate through the same code path, so no arrangement
// can skip validation. A step that needs a custom layout (e.g. a full-bleed
// SQL editor) simply omits Modal.Body.
//
// Most wizards should use the pre-composed ui/Modal/Patterns/
// MultiStepModalStandard instead, and drop to these parts only when the
// layout is non-standard.
//
// Steps and Done must be direct children of Root (fragments, arrays, and
// conditionals are fine): Root reads their props to build the step list.
// ---------------------------------------------------------------------------

export type StepProps = {
  // Label shown in the Stepper and used for page-change tracking.
  label: string;
  // A disabled step is skipped by Next/Back and ignored by the Stepper.
  // Defaults to true.
  enabled?: boolean;
  // Checks the step's own fields. Throw to block moving forward; the modal
  // snaps to the first step whose validator throws and shows the message.
  // Re-runs on every forward move past this step and on final submit, so it
  // must be side-effect free. Put saves and fetches in onNext instead.
  validate?: () => Promise<void>;
  // Side effect that runs when the user moves forward past this step (Next,
  // or a Stepper/goToStep jump past it), after validation passes. Use it for
  // mid-flow commits and fetches. Throw to stay on this step and show the
  // message. Not re-run by later steps' validation.
  onNext?: () => void | Promise<void>;
  // Gates the Next button while this step is active. Defaults to true.
  nextEnabled?: boolean;
  // Tooltip on the disabled Next button when nextEnabled is false.
  disabledMessage?: string;
  // Overrides Root's size while this step is active, for pages that need
  // more room (e.g. an editor).
  size?: Size;
  children: ReactNode;
};

type StepRecord = Omit<StepProps, "children" | "enabled" | "nextEnabled"> & {
  enabled: boolean;
  nextEnabled: boolean;
};

// Root wraps each Step / Done it finds in one of these, so the part knows
// its position without registering itself.
const StepIndexContext = createContext<number | null>(null);
const DoneSlotContext = createContext(false);

type MultiStepModalContextValue = {
  steps: StepRecord[];
  step: number;
  prevStep: number | null;
  isLastStep: boolean;
  isDone: boolean;
  goToStep: (target: number) => Promise<void>;
  back: () => void;
  close: () => void;
};

const MultiStepModalContext = createContext<MultiStepModalContextValue | null>(
  null,
);

function useMultiStepModalContext(): MultiStepModalContextValue {
  const ctx = useContext(MultiStepModalContext);
  if (!ctx) {
    throw new Error(
      "MultiStepModal parts must be rendered inside <MultiStepModal.Root>.",
    );
  }
  return ctx;
}

// Navigation for step content that needs to move the flow itself, such as a
// "go back and edit" link or a restart when an early field changes. Forward
// jumps run the same validate + onNext path as the Next button.
export function useMultiStepModal() {
  const { steps, step, isLastStep, isDone, goToStep, back, close } =
    useMultiStepModalContext();
  return {
    step,
    stepCount: steps.length,
    isLastStep,
    isDone,
    goToStep,
    back,
    close,
  };
}

// Expands fragments (Children.toArray already flattens arrays) so steps can be
// grouped in conditional fragments. Keys are prefixed to stay unique.
export function flattenChildren(
  children: ReactNode,
  keyPrefix = "",
): ReactNode[] {
  const out: ReactNode[] = [];
  Children.toArray(children).forEach((child) => {
    if (
      isValidElement<{ children?: ReactNode }>(child) &&
      child.type === Fragment
    ) {
      out.push(
        ...flattenChildren(child.props.children, `${keyPrefix}${child.key}:`),
      );
    } else if (isValidElement(child) && keyPrefix) {
      out.push(cloneElement(child, { key: `${keyPrefix}${child.key}` }));
    } else {
      out.push(child);
    }
  });
  return out;
}

export function isStepElement(
  node: ReactNode,
): node is ReactElement<StepProps> {
  return isValidElement(node) && node.type === Step;
}

export function isDoneElement(
  node: ReactNode,
): node is ReactElement<{ children: ReactNode }> {
  return isValidElement(node) && node.type === Done;
}

function findEnabledStep(
  steps: StepRecord[],
  from: number,
  dir: 1 | -1,
): number | null {
  for (let i = from + dir; i >= 0 && i < steps.length; i += dir) {
    if (steps[i].enabled) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export type RootProps = TrackingEventModalProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Default size for every step; a Step may override it.
  size?: Size;
  // Step to open on. The step resets to this whenever the modal reopens.
  initialStep?: number;
  // Runs when Next is pressed on the last step, after every step validates.
  // On success the modal shows <MultiStepModal.Done> if there is one,
  // otherwise it closes.
  onSubmit?: () => void | Promise<void>;
  children: ReactNode;
};

function Root({
  open,
  onOpenChange,
  size = "md",
  initialStep = 0,
  onSubmit,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps,
  children,
}: RootProps) {
  const [step, setStep] = useState(initialStep);
  const [isDone, setIsDone] = useState(false);

  // Reset when the modal reopens. Root stays mounted while `open` toggles, so
  // without this a reopened wizard would resume where it was closed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(initialStep);
      setIsDone(false);
    }
  }

  const nodes = flattenChildren(children);
  const steps: StepRecord[] = nodes.filter(isStepElement).map(({ props }) => ({
    label: props.label,
    enabled: props.enabled !== false,
    validate: props.validate,
    onNext: props.onNext,
    nextEnabled: props.nextEnabled !== false,
    disabledMessage: props.disabledMessage,
    size: props.size,
  }));
  // Keep the index valid when conditional steps disappear.
  const activeStep = Math.max(0, Math.min(step, steps.length - 1));
  const hasDone = nodes.some(isDoneElement);
  const hasOwnDescription = nodes.some(
    (node) => isValidElement(node) && node.type === Modal.Description,
  );

  let stepIndex = 0;
  const content = nodes.map((node) => {
    if (isStepElement(node)) {
      const index = stepIndex++;
      return (
        <StepIndexContext.Provider key={node.key ?? index} value={index}>
          {node}
        </StepIndexContext.Provider>
      );
    }
    if (isDoneElement(node)) {
      return (
        <DoneSlotContext.Provider key={node.key ?? "done"} value>
          {node}
        </DoneSlotContext.Provider>
      );
    }
    return node;
  });

  return (
    <Modal.Root
      open={open}
      onOpenChange={onOpenChange}
      size={isDone ? size : (steps[activeStep]?.size ?? size)}
      // Always described: by the consumer's Modal.Description if present,
      // otherwise by the hidden step-progress text Controller renders.
      hasDescription
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      <Controller
        steps={steps}
        step={activeStep}
        setStep={setStep}
        isDone={isDone}
        setIsDone={setIsDone}
        hasDone={hasDone}
        onSubmit={onSubmit}
        close={() => onOpenChange(false)}
        describeProgress={!hasOwnDescription}
      >
        {content}
      </Controller>
    </Modal.Root>
  );
}

// Rendered inside Modal.Root so it can use the Modal context (errors,
// tracking). Owns the navigation logic and wraps everything in ModalForm so
// Next is a real submit: Enter advances, and loading and errors are handled
// the same way as a single-page modal.
function Controller({
  steps,
  step,
  setStep,
  isDone,
  setIsDone,
  hasDone,
  onSubmit,
  close,
  describeProgress,
  children,
}: {
  steps: StepRecord[];
  step: number;
  setStep: (step: number) => void;
  isDone: boolean;
  setIsDone: (isDone: boolean) => void;
  hasDone: boolean;
  onSubmit?: () => void | Promise<void>;
  close: () => void;
  describeProgress: boolean;
  children: ReactNode;
}) {
  const { setError, sendTrackingEvent } = useModalContext();
  const prevStep = findEnabledStep(steps, step, -1);
  const nextStep = findEnabledStep(steps, step, 1);
  const isLastStep = nextStep === null;
  const current: StepRecord | undefined = steps[step];

  // Validate every enabled step before `before`. The failing step is the
  // index the loop is on, so the modal snaps to it.
  async function validateBefore(before: number) {
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

  // Run onNext for each enabled step being left, in order.
  async function runOnNext(from: number, to: number) {
    for (let i = from; i < to; i++) {
      if (!steps[i].enabled) continue;
      try {
        await steps[i].onNext?.();
      } catch (e) {
        setStep(i);
        throw e;
      }
    }
  }

  async function advanceTo(target: number) {
    await validateBefore(target);
    await runOnNext(step, target);
    setStep(target);
  }

  // Programmatic / Stepper navigation. Backward is free; forward goes through
  // validate + onNext. Errors surface in the modal's ErrorDisplay.
  async function goToStep(target: number) {
    if (isDone || target === step || !steps[target]?.enabled) return;
    setError(null);
    if (target < step) {
      setStep(target);
      return;
    }
    try {
      await advanceTo(target);
    } catch (e) {
      setError(e.message);
    }
  }

  function back() {
    if (isDone || prevStep === null) return;
    setError(null);
    setStep(prevStep);
  }

  // ModalForm's onSubmit. Throwing lets ModalForm show the error and stop the
  // spinner.
  async function handleNext() {
    // Enter can submit the form even while Next is disabled.
    if (isDone || !current || !current.nextEnabled) return;
    if (nextStep !== null) {
      await advanceTo(nextStep);
      return;
    }
    await validateBefore(steps.length);
    await runOnNext(step, step + 1);
    await onSubmit?.();
    if (hasDone) {
      setIsDone(true);
    } else {
      close();
    }
  }

  useEffect(() => {
    sendTrackingEvent("modal-page-change", {
      step: isDone ? steps.length + 1 : step + 1,
      steps: steps.length,
      pageName: isDone ? "Done" : steps[step]?.label,
    });
    // Fire on page changes only, matching the legacy PagedModal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isDone]);

  return (
    <MultiStepModalContext.Provider
      value={{
        steps,
        step,
        prevStep,
        isLastStep,
        isDone,
        goToStep,
        back,
        close,
      }}
    >
      <ModalForm onSubmit={handleNext} trackOnSubmit={isLastStep && !isDone}>
        {describeProgress && current ? (
          <VisuallyHidden asChild>
            <Dialog.Description>
              {isDone
                ? "All steps complete"
                : `Step ${step + 1} of ${steps.length}: ${current.label}`}
            </Dialog.Description>
          </VisuallyHidden>
        ) : null}
        {children}
      </ModalForm>
    </MultiStepModalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Step and Done
// ---------------------------------------------------------------------------

// Renders its children while it is the active step. Root reads the rest of
// its props to build the step list.
function Step({ children }: StepProps) {
  const index = useContext(StepIndexContext);
  const { step, isDone } = useMultiStepModalContext();
  if (index === null) {
    throw new Error(
      "<MultiStepModal.Step> must be a direct child of <MultiStepModal.Root>.",
    );
  }
  return !isDone && index === step ? <>{children}</> : null;
}

// Shown in place of the steps after onSubmit succeeds, for confirmation or
// "what's next" content. Without it the modal closes on submit.
function Done({ children }: { children: ReactNode }) {
  const inSlot = useContext(DoneSlotContext);
  const { isDone } = useMultiStepModalContext();
  if (!inSlot) {
    throw new Error(
      "<MultiStepModal.Done> must be a direct child of <MultiStepModal.Root>.",
    );
  }
  return isDone ? <>{children}</> : null;
}

// ---------------------------------------------------------------------------
// Stepper — progress at the top of the modal, in the description slot.
//
// Visual only: the accessible description is the "Step 2 of 3: …" text
// Controller renders, since Dialog.Description is a <p> and cannot contain
// the Stepper's markup. Clicks route through goToStep, so they validate like
// Next and ignore disabled steps. After submit every step shows as complete.
// ---------------------------------------------------------------------------

function Stepper() {
  const { steps, step, isDone, goToStep } = useMultiStepModalContext();
  const { setError } = useModalContext();
  return (
    <Box pr="7" mt="4">
      <StepperNav
        step={isDone ? steps.length : step}
        setStep={(target) => {
          void goToStep(target);
        }}
        steps={steps.map(({ label, enabled }) => ({
          label,
          enabled: enabled && !isDone,
        }))}
        setError={setError}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Footer parts
// ---------------------------------------------------------------------------

// Hidden (but still occupying its slot, so a space-between footer keeps its
// layout) on the first step and after submit.
function Back() {
  const { prevStep, isDone, back } = useMultiStepModalContext();
  if (isDone || prevStep === null) return <Box />;
  return (
    <Button variant="ghost" icon={<PiArrowLeft />} onClick={back}>
      Back
    </Button>
  );
}

// The primary button. "Next" on intermediate steps and `submitLabel` on the
// last. Pass children to replace the label, e.g. with state-driven copy.
// Hidden after submit.
function Next({
  submitLabel = "Save",
  children,
}: {
  submitLabel?: string;
  children?: string;
}) {
  const { steps, step, isLastStep, isDone } = useMultiStepModalContext();
  const { loading } = useModalForm();
  if (isDone) return null;
  const current: StepRecord | undefined = steps[step];
  const enabled = current?.nextEnabled ?? true;
  const button = (
    <Button
      type="submit"
      disabled={!enabled}
      loading={loading}
      icon={isLastStep || children ? undefined : <PiCaretRight />}
      iconPosition="right"
    >
      {children ?? (isLastStep ? submitLabel : "Next")}
    </Button>
  );
  if (!enabled && current?.disabledMessage) {
    // The span keeps the tooltip working while the button is disabled.
    return (
      <Tooltip content={current.disabledMessage}>
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}

// The standard footer: Back on the left; Cancel + Next on the right; a single
// Close after submit. Compose Modal.Footer with Back / Next yourself when a
// wizard needs something else in the footer.
function Footer({ submitLabel }: { submitLabel?: string }) {
  const { isDone, close } = useMultiStepModalContext();
  return (
    <Modal.Footer justify="between">
      <Back />
      <Flex gap="3" align="center">
        {isDone ? (
          <Button onClick={close}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Next submitLabel={submitLabel} />
          </>
        )}
      </Flex>
    </Modal.Footer>
  );
}

// ---------------------------------------------------------------------------
// Namespace export, mirroring Modal.
// ---------------------------------------------------------------------------

const MultiStepModal = {
  Root,
  Step,
  Done,
  Stepper,
  Back,
  Next,
  Footer,
};

export default MultiStepModal;
