import { Box, Flex, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { Fragment } from "react";
import { PiCheck, PiCircleDashed } from "react-icons/pi";
import styles from "./Stepper.module.scss";

export type StepperStep = {
  label: string;
  enabled: boolean;
};

type Props = {
  steps: StepperStep[];
  step: number;
  setStep: (step: number) => void;
  // Steps before the current one that were passed over rather than completed.
  skipped?: Set<number>;
};

export default function Stepper({ steps, step, setStep, skipped }: Props) {
  return (
    <Flex align="center" width="100%" className={styles.stepper}>
      {steps.map(({ label, enabled }, i) => {
        const isSkipped = i < step && !!skipped?.has(i);
        const isCompleted = i < step && !isSkipped;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <Box
                className={clsx(styles.connector, {
                  [styles.completed]: isCompleted || isSkipped,
                })}
              />
            )}
            <button
              type="button"
              className={clsx(styles.step, {
                [styles.active]: i === step,
                [styles.completed]: isCompleted,
              })}
              disabled={!enabled}
              aria-current={i === step ? "step" : undefined}
              onClick={() => setStep(i)}
            >
              <Flex
                align="center"
                justify="center"
                flexShrink="0"
                className={styles.indicator}
              >
                {isCompleted ? (
                  <PiCheck />
                ) : isSkipped ? (
                  <PiCircleDashed />
                ) : (
                  <Text size="1" weight="bold">
                    {i + 1}
                  </Text>
                )}
              </Flex>
              <Text size="2" weight="medium" className={styles.label}>
                {label}
              </Text>
            </button>
          </Fragment>
        );
      })}
    </Flex>
  );
}
