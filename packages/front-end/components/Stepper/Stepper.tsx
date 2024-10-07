import clsx from "clsx";
import { MdCheck } from "react-icons/md";
import { PiCircleDashed } from "react-icons/pi";

type Step = {
  label: string;
  enabled: boolean;
};

interface Props {
  step: number;
  setStep: (step: number) => void;
  steps: Step[];
  setError: (error: string) => void;
  skipped?: Set<number>;
  validateSteps?: (step: number) => Promise<void>;
}

export default function Stepper({
  step,
  setStep,
  steps,
  skipped,
  setError,
  validateSteps,
}: Props) {
  return (
    <nav
      className={
        "nav mb-4 justify-content-start nav-default paged-modal-default"
      }
    >
      {steps.map(({ label, enabled }, i) => {
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
              className={clsx("nav-link")}
              onClick={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  await validateSteps?.(i);
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
              <span className="step-title">{label}</span>
            </a>
          </div>
        );
      })}
    </nav>
  );
}
