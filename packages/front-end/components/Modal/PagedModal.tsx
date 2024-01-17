import clsx from "clsx";
import {
  ReactElement,
  useState,
  Children,
  FC,
  isValidElement,
  ReactNode,
} from "react";
import { MdCheck } from "react-icons/md";
import Modal from "../Modal";
import { DocSection } from "../DocLink";

type Props = {
  header: string;
  submitColor?: string;
  cta?: string;
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
  step: number;
  setStep: (step: number) => void;
  secondaryCTA?: ReactElement;
  className?: string;
  bodyClassName?: string;
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
    cta,
    ctaEnabled = true,
    forceCtaText,
    inline,
    secondaryCTA,
    size,
    // size = "md",
    className,
    bodyClassName,
    ...passThrough
  } = props;

  const [error, setError] = useState("");
  const style = navStyle ? navStyle : "default";
  const steps: {
    display: string;
    enabled: boolean;
    validate?: () => Promise<void>;
  }[] = [];
  let content: ReactNode;
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'number'.
  let nextStep: number = null;
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'number'.
  let prevStep: number = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { display, enabled, validate } = child.props;
    if (content && enabled !== false && !nextStep) {
      nextStep = steps.length;
    }
    if (step === steps.length) {
      content = <>{child}</>;
    }
    steps.push({ display, enabled, validate });
  });

  prevStep = step - 1;
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'number'.
  if (prevStep < 0) prevStep = null;

  async function validateSteps(before?: number) {
    before = before ?? steps.length;
    for (let i = 0; i < before; i++) {
      if (steps[i].enabled === false) continue;
      if (!steps[i].validate) continue;
      try {
        // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
        await steps[i].validate();
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
        } else {
          setStep(nextStep);
        }
      }}
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Element | null' is not assignable to type 'R... Remove this comment to see the full error message
      secondaryCTA={
        secondaryCTA ? (
          secondaryCTA
        ) : backButton && prevStep !== null ? (
          <button
            className={`btn btn-outline-primary mr-3`}
            onClick={(e) => {
              e.preventDefault();
              setStep(prevStep);
            }}
          >
            back
          </button>
        ) : null
      }
      error={error}
      autoCloseOnSubmit={false}
      cta={forceCtaText || !nextStep ? cta : "Next"}
      ctaEnabled={ctaEnabled}
    >
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
                    completed: i < step,
                    disabled: !enabled,
                  }
                )}
                key={i}
              >
                <a
                  key={i}
                  role="button"
                  className={clsx("nav-link")}
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
                    {i < step ? <MdCheck /> : i + 1}
                  </span>
                  <span className="step-title"> {display}</span>
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
      {content}
    </Modal>
  );
};

export default PagedModal;
