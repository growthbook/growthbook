import clsx from "clsx";
import { Children, FC, isValidElement, ReactNode } from "react";
import Modal from "../Modal";

type Props = {
  header: string;
  submitColor?: string;
  cta?: string;
  closeCta?: string;
  size?: "md" | "lg" | "max";
  inline?: boolean;
  close: () => void;
  submit: () => Promise<void>;

  step: number;
  setStep: (number) => void;
};

const PagedModal: FC<Props> = (props) => {
  const { step, setStep, children, submit, cta, ...passThrough } = props;

  const steps: { display: string; enabled: boolean }[] = [];
  let content: ReactNode;
  let nextStep: number = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { display, enabled } = child.props;
    if (content && enabled !== false && !nextStep) {
      nextStep = steps.length;
    }
    if (step === steps.length) {
      content = <>{child}</>;
    }
    steps.push({ display, enabled });
  });

  return (
    <Modal
      open={true}
      {...passThrough}
      submit={async () => {
        if (!nextStep) {
          await submit();
          props.close();
        } else {
          setStep(nextStep);
        }
      }}
      autoCloseOnSubmit={false}
      cta={!nextStep ? cta : "Next"}
    >
      <nav className="nav nav-pills nav-fill mb-4 justify-content-start">
        {steps.map(({ display, enabled }, i) => (
          <a
            key={i}
            href="#"
            className={clsx("w-md-100 nav-item nav-link", {
              active: step === i,
              disabled: enabled === false,
            })}
            onClick={(e) => {
              e.preventDefault();
              setStep(i);
            }}
          >
            {i + 1}. {display}
          </a>
        ))}
      </nav>
      {content}
    </Modal>
  );
};

export default PagedModal;
