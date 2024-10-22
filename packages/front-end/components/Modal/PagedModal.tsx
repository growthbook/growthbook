import clsx from "clsx";
import React, {
  ReactElement,
  useState,
  Children,
  FC,
  isValidElement,
  ReactNode,
} from "react";
import { MdCheck } from "react-icons/md";
import { PiArrowLeft, PiCaretRight, PiCircleDashed } from "react-icons/pi";
import Modal from "@/components/Modal";
import { DocSection } from "@/components/DocLink";

type Props = {
  header: string;
  subHeader?: string | ReactNode;
  submitColor?: string;
  cta?: string | ReactNode;
  ctaEnabled?: boolean;
  forceCtaText?: boolean;
  closeCta?: string;
  disabledMessage?: string;
  size?: "md" | "lg" | "max" | "fill";
  docSection?: DocSection;
  navStyle?: "pills" | "underlined" | "tabs" | "default";
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
    forceCtaText,
    inline,
    size,
    className,
    bodyClassName,
    onSkip,
    skipped,
    hideNav,
    ...passThrough
  } = props;

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

  return (
    <Modal
      trackingEventModalType=""
      inline={inline}
      size={size}
      disabledMessage={disabledMessage}
      open={true}
      className={className}
      bodyClassName={bodyClassName}
      {...passThrough}
      submit={async () => {
        await validateSteps(nextStep);
        if (!nextStep) {
          await submit();
          if (props.close) {
            props.close();
          }
        } else if (steps[nextStep - 1].customNext) {
          steps[nextStep - 1].customNext?.();
        } else {
          setStep(nextStep);
        }
      }}
      backCTA={
        backButton && ((prevStep ?? 0) >= 0 || onBackFirstStep) ? (
          <button
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
        onSkip ? (
          <button
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
    >
      {!hideNav ? (
        <nav
          className={`nav mb-4 justify-content-start ${navStyleClass} ${navFillClass} ${
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
                    }
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
                    <div
                      className="step-title ml-1"
                      style={{ lineHeight: "18px" }}
                    >
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
      ) : null}
      {content}
    </Modal>
  );
};

export default PagedModal;
