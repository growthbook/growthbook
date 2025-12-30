import clsx from "clsx";
import React, {
  ReactElement,
  useState,
  Children,
  FC,
  isValidElement,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import { MdCheck } from "react-icons/md";
import { PiArrowLeft, PiCaretRight, PiCircleDashed } from "react-icons/pi";
import { v4 as uuidv4 } from "uuid";
import Modal from "@/components/Modal";
import { DocSection } from "@/components/DocLink";
import track, { TrackEventProps } from "@/services/track";

type Props = {
  header: string | null;
  subHeader?: string | ReactNode;
  submitColor?: string;
  hideCta?: boolean;
  cta?: string | ReactNode;
  ctaEnabled?: boolean;
  forceCtaText?: boolean;
  closeCta?: string;
  includeCloseCta?: boolean;
  disabledMessage?: string;
  autoCloseOnSubmit?: boolean;
  loading?: boolean;
  size?: "md" | "lg" | "max" | "fill";
  docSection?: DocSection;
  navStyle?: "pills" | "underlined" | "tabs" | "default";
  showHeaderCloseButton?: boolean;
  navFill?: boolean;
  inline?: boolean;
  close?: () => void;
  submit: () => Promise<void>;
  children: ReactNode;
  backButton?: boolean;
  onBackFirstStep?: () => void;
  step: number;
  setStep: (step: number) => void;
  secondaryCTA?: ReactElement;
  className?: string;
  bodyClassName?: string;
  stickyFooter?: boolean;
  onSkip?: () => Promise<void>;
  skipped?: Set<number>;
  hideNav?: boolean;
  // An empty string will prevent firing a tracking event, but the prop is still required to encourage developers to add tracking
  trackingEventModalType: string;
  // The source (likely page or component) causing the modal to be shown
  trackingEventModalSource?: string;
  // Currently the allowlist for what event props are valid is controlled outside of the codebase.
  // Make sure you've checked that any props you pass here are in the list!
  allowlistedTrackingEventProps?: TrackEventProps;
};

const PagedModal: FC<Props> = (props) => {
  const {
    step,
    setStep,
    children,
    disabledMessage,
    submit,
    navStyle,
    navFill,
    backButton = false,
    onBackFirstStep,
    cta,
    ctaEnabled = true,
    autoCloseOnSubmit = true,
    showHeaderCloseButton = true,
    forceCtaText,
    inline,
    secondaryCTA,
    size,
    className,
    bodyClassName,
    onSkip,
    skipped,
    hideNav,
    loading,
    trackingEventModalType,
    trackingEventModalSource,
    allowlistedTrackingEventProps = {},
    header,
    ...passThrough
  } = props;
  const [modalUuid] = useState(uuidv4());

  const [error, setError] = useState("");
  const style = navStyle ? navStyle : "default";
  const steps: {
    display: string;
    enabled: boolean;
    validate?: () => Promise<void>;
    customNext?: () => void;
  }[] = [];
  let content: ReactNode;
  let nextStep: number | undefined = undefined;
  let prevStep: number | undefined = undefined;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { display, enabled, validate, customNext } = child.props;
    if (content && enabled !== false && !nextStep) {
      nextStep = steps.length;
    }
    if (step === steps.length) {
      content = <>{child}</>;
    }
    steps.push({ display, enabled, validate, customNext });
  });

  prevStep = step - 1;
  if (prevStep < 0) prevStep = undefined;

  async function validateSteps(before?: number) {
    before = before ?? steps.length;
    for (let i = 0; i < before; i++) {
      if (!steps[i].enabled) continue;
      if (!steps[i].validate) continue;
      try {
        await steps[i].validate?.();
      } catch (e) {
        setStep(i);
        throw e;
      }
    }
  }

  const navStyleClass = navStyle ? "nav-" + navStyle : "nav-default";

  const navFillClass =
    typeof navFill === "undefined" ? "nav-fill" : navFill ? "nav-fill" : "";

  const sendTrackingEvent = useCallback(
    (eventName: string, additionalProps?: Record<string, unknown>) => {
      if (trackingEventModalType === "") {
        return;
      }
      track(eventName, {
        type: trackingEventModalType,
        source: trackingEventModalSource,
        eventGroupUuid: modalUuid,
        ...allowlistedTrackingEventProps,
        ...(additionalProps || {}),
      });
    },
    [
      trackingEventModalType,
      trackingEventModalSource,
      allowlistedTrackingEventProps,
      modalUuid,
    ],
  );

  useEffect(() => {
    let pageName = "";
    try {
      const display: unknown = steps?.[step]?.display;
      if (typeof display === "string") {
        pageName = display;
      } else {
        const children = (display as ReactElement)?.props?.children;
        if (children instanceof Array) {
          pageName = children
            .map((c) => (typeof c === "string" ? c : " "))
            .join("")
            .trim();
        }
      }
    } catch (e) {
      // ignore
    }
    sendTrackingEvent("modal-page-change", {
      step: step + 1,
      steps: steps?.length,
      pageName,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const stepper = !hideNav ? (
    <nav
      className={`nav mb-3 justify-content-start ${navStyleClass} ${navFillClass} ${
        style === "default" && "paged-modal-default"
      }`}
    >
      {steps.map(({ display, enabled }, i) => {
        if (navStyleClass === "nav-default") {
          return (
            <div
              className={clsx(
                "step d-flex align-items-center justify-content-between",
                {
                  active: step === i,
                  completed: i < step && !skipped?.has(i),
                  disabled: !enabled,
                },
              )}
              key={i}
            >
              <a
                key={i}
                role="button"
                className="nav-link d-flex align-items-center"
                onClick={async (e) => {
                  e.preventDefault();
                  setError("");
                  try {
                    await validateSteps(i);
                    setStep(i);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <span className="step-number rounded-circle">
                  {i < step ? (
                    skipped?.has(i) ? (
                      <PiCircleDashed />
                    ) : (
                      <MdCheck />
                    )
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="step-title ml-1" style={{ lineHeight: "18px" }}>
                  {display}
                </div>
              </a>
            </div>
          );
        } else {
          return (
            <a
              key={i}
              role="button"
              className={clsx("w-md-100 nav-item nav-link", {
                active: step === i,
                disabled: !enabled,
              })}
              onClick={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  await validateSteps(i);
                  setStep(i);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              {i + 1}. {display}
            </a>
          );
        }
      })}
    </nav>
  ) : null;

  return (
    <Modal
      inline={inline}
      size={size}
      disabledMessage={disabledMessage}
      open={true}
      loading={loading}
      className={className}
      bodyClassName={bodyClassName}
      header={header}
      showHeaderCloseButton={showHeaderCloseButton}
      {...passThrough}
      trackOnSubmit={!nextStep}
      submit={async () => {
        await validateSteps(nextStep);
        if (!nextStep) {
          await submit();
          if (props.close && autoCloseOnSubmit) {
            props.close();
          }
        } else if (steps[nextStep - 1].customNext) {
          steps[nextStep - 1].customNext?.();
        } else {
          setStep(nextStep);
        }
      }}
      backCTA={
        backButton && (step >= 1 || onBackFirstStep) ? (
          <button
            type="button"
            className={`btn btn-link mr-3`}
            onClick={(e) => {
              e.preventDefault();
              if (step <= 0 && onBackFirstStep) {
                onBackFirstStep();
              } else {
                setStep(prevStep ?? 0);
              }
            }}
          >
            <PiArrowLeft className="mr-1" />
            Back
          </button>
        ) : null
      }
      secondaryCTA={
        secondaryCTA ? (
          secondaryCTA
        ) : onSkip ? (
          <button
            type="button"
            className={`btn btn-link mr-3`}
            onClick={(e) => {
              e.preventDefault();
              onSkip();
            }}
          >
            Skip
          </button>
        ) : null
      }
      error={error}
      autoCloseOnSubmit={false}
      cta={
        forceCtaText || !nextStep ? (
          cta
        ) : (
          <>
            Next{" "}
            <PiCaretRight className="position-relative" style={{ top: -1 }} />
          </>
        )
      }
      ctaEnabled={ctaEnabled}
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      allowlistedTrackingEventProps={allowlistedTrackingEventProps}
      modalUuid={modalUuid}
      aboveBodyContent={stepper}
    >
      <div className="mt-2">{content}</div>
    </Modal>
  );
};

export default PagedModal;
