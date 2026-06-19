import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { PiCheck, PiCircleDashed } from "react-icons/pi";
import Link from "@/ui/Link";

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
    <Flex
      as="div"
      justify="start"
      className="nav nav-default paged-modal-default"
      mb="4"
    >
      {steps.map(({ label, enabled }, i) => {
        return (
          <Flex
            as="div"
            align="center"
            justify="between"
            className={clsx("step", {
              active: step === i,
              completed: i < step && !skipped?.has(i),
              disabled: !enabled,
            })}
            key={i}
          >
            <Link
              key={i}
              className="nav-link"
              onClick={async () => {
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
                    <PiCheck />
                  )
                ) : (
                  i + 1
                )}
              </span>
              <span className="step-title">{label}</span>
            </Link>
          </Flex>
        );
      })}
    </Flex>
  );
}
