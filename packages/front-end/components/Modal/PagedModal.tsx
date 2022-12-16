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
  closeCta?: string;
  ctaEnabled?: boolean;
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
};

const PagedModal: FC<Props> = (props) => {
  const {
    step,
    setStep,
    children,
    submit,
    navStyle,
    navFill,
    backButton = false,
    cta,
    inline,
    secondaryCTA,
    size,
    // size = "md",
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
  let nextStep: number = null;
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
  if (prevStep < 0) prevStep = null;

  async function validateSteps(before?: number) {
    before = before ?? steps.length;
    for (let i = 0; i < before; i++) {
      if (steps[i].enabled === false) continue;
      if (!steps[i].validate) continue;
      try {
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
      open={true}
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
      cta={!nextStep ? cta : "Next"}
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
                    disabled: enabled === false,
                  }
                )}
                key={i}
              >
                <a
                  key={i}
                  href="#"
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
                href="#"
                className={clsx("w-md-100 nav-item nav-link", {
                  active: step === i,
                  disabled: enabled === false,
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
