import { Box, Flex } from "@radix-ui/themes";
import {
  Children,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
} from "react";
import { PiArrowLeft, PiCaretRight } from "react-icons/pi";
import Button, { Color as ButtonColor } from "@/ui/Button";
import Modal, {
  Size,
  TrackingEventModalProps,
  useModalContext,
} from "@/ui/Modal";
import Stepper from "@/components/Stepper/Stepper";
import ModalForm, { useModalForm } from "../ModalForm";

// ---------------------------------------------------------------------------
// ModalPaged.Page
//
// Passthrough child used to declare each step of a ModalPaged. The parent
// reads display/enabled/validate off the child's props while iterating
// children to build its internal `steps` array.
// ---------------------------------------------------------------------------

export type ModalPagedPageProps = {
  display: string;
  enabled?: boolean;
  validate?: () => Promise<void>;
  children: ReactNode;
};

function Page({ children }: ModalPagedPageProps) {
  return <>{children}</>;
}

type StepMeta = {
  display: string;
  enabled: boolean;
  validate?: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// PageChangeTracker
//
// Lives inside <Modal.Root> so it can call useModalContext().sendTrackingEvent
// when the active step changes. Mirrors the modal-page-change event from the
// legacy PagedModal.
// ---------------------------------------------------------------------------

function PageChangeTracker({
  step,
  steps,
}: {
  step: number;
  steps: StepMeta[];
}) {
  const { sendTrackingEvent } = useModalContext();
  useEffect(() => {
    sendTrackingEvent("modal-page-change", {
      step: step + 1,
      steps: steps.length,
      pageName: steps[step]?.display ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  return null;
}

// ---------------------------------------------------------------------------
// SubmitButton
//
// Reads loading from <ModalForm> so the Next / Save button shows a spinner
// while submission (or step validation) is in flight.
// ---------------------------------------------------------------------------

function SubmitButton({
  isLastStep,
  cta,
  ctaColor,
  ctaEnabled,
}: {
  isLastStep: boolean;
  cta: string;
  ctaColor: ButtonColor;
  ctaEnabled: boolean;
}) {
  const { loading } = useModalForm();
  return (
    <Button
      type="submit"
      disabled={!ctaEnabled}
      color={ctaColor}
      loading={loading}
    >
      {isLastStep ? (
        cta
      ) : (
        <Flex as="span" align="center" gap="1">
          Next
          <PiCaretRight />
        </Flex>
      )}
    </Button>
  );
}

export type Props = TrackingEventModalProps & {
  open: boolean;
  close: () => void;
  header: string;
  subheader?: ReactNode;
  size?: Size;
  step: number;
  setStep: (step: number) => void;
  submit: () => void | Promise<void>;
  cta?: string;
  ctaColor?: ButtonColor;
  ctaEnabled?: boolean;
  children: ReactNode;
};

// ModalPaged is the multi-step counterpart to ModalStandard: it composes the
// new Modal primitives plus the existing Stepper into an opinionated wizard
// layout (header + stepper + scrollable body + Back / Cancel / Next-or-Save
// footer). Steps are declared as <ModalPaged.Page display="..."> children.
function ModalPaged({
  open,
  close,
  header,
  subheader,
  size = "md",
  step,
  setStep,
  submit,
  cta = "Save",
  ctaColor = "violet",
  ctaEnabled = true,
  trackingEventModalType,
  trackingEventModalSource,
  allowlistedTrackingEventProps = {},
  children,
}: Props) {
  const { steps, currentContent } = useMemo(() => {
    const collected: StepMeta[] = [];
    let content: ReactNode = null;
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      const {
        display,
        enabled = true,
        validate,
      } = (child as ReactElement<ModalPagedPageProps>).props;
      if (collected.length === step) {
        content = child;
      }
      collected.push({ display, enabled, validate });
    });
    return { steps: collected, currentContent: content };
  }, [children, step]);

  const isLastStep = step >= steps.length - 1;

  const validateSteps = async (before: number) => {
    const limit = Math.min(before, steps.length);
    for (let i = 0; i < limit; i++) {
      if (!steps[i].enabled) continue;
      if (!steps[i].validate) continue;
      try {
        await steps[i].validate?.();
      } catch (e) {
        setStep(i);
        throw e;
      }
    }
  };

  const handleSubmit = async () => {
    await validateSteps(step + 1);
    if (isLastStep) {
      await submit();
      close();
      return;
    }
    setStep(step + 1);
  };

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size={size}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
    >
      <ModalForm onSubmit={handleSubmit} trackOnSubmit={isLastStep}>
        <Modal.Header>
          <Modal.Title>{header}</Modal.Title>
        </Modal.Header>
        {subheader && <Modal.Description>{subheader}</Modal.Description>}
        <PageChangeTracker step={step} steps={steps} />
        <Box flexShrink="0" pr="7" mt="4">
          <StepperWithModalError
            step={step}
            setStep={setStep}
            steps={steps}
            validateSteps={validateSteps}
          />
        </Box>
        <Modal.Body>{currentContent}</Modal.Body>
        <Modal.Footer justify="between">
          <Box>
            {step > 0 && (
              <Button
                variant="ghost"
                onClick={() => setStep(step - 1)}
                icon={<PiArrowLeft />}
                iconPosition="left"
              >
                Back
              </Button>
            )}
          </Box>
          <Flex gap="3">
            <Modal.Close>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </Modal.Close>
            <SubmitButton
              isLastStep={isLastStep}
              cta={cta}
              ctaColor={ctaColor}
              ctaEnabled={ctaEnabled}
            />
          </Flex>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

// Wires the existing Stepper's setError into the Modal context so failed
// step-jump validation surfaces in <Modal.Body>'s built-in <ErrorDisplay>.
function StepperWithModalError({
  step,
  setStep,
  steps,
  validateSteps,
}: {
  step: number;
  setStep: (step: number) => void;
  steps: StepMeta[];
  validateSteps: (before: number) => Promise<void>;
}) {
  const { setError } = useModalContext();
  return (
    <Stepper
      step={step}
      setStep={setStep}
      steps={steps.map(({ display, enabled }) => ({
        label: display,
        enabled,
      }))}
      setError={(msg) => setError(msg || null)}
      validateSteps={validateSteps}
    />
  );
}

ModalPaged.Page = Page;

export default ModalPaged;
