import React from "react";
import { FaCheck } from "react-icons/fa";
import clsx from "clsx";
import { Task } from "./GuidedGetStarted";
import styles from "./GetStartedSteps.module.scss";

type Props = {
  currentStep: number | null;
  setCurrentStep: (number) => void;
  steps: Task[];
};

export default function GetStartedSteps({
  setCurrentStep,
  currentStep,
  steps,
}: Props) {
  return (
    <div className="d-flex flex-column justify-content-center align-items-center pt-4 pb-4">
      <div className={clsx(styles.statusBar)}></div>
      <div
        className={clsx(
          "d-flex flex-row justify-content-between col-10 p-2",
          styles.bubbleWrapper
        )}
      >
        {steps.map((step, index) => (
          <div
            role="button"
            onClick={() => {
              setCurrentStep(index);
            }}
            key={index}
            className={clsx(
              styles.stepBubble,
              step.completed && styles.completed,
              currentStep == index && styles.selected,
              "p-3 d-flex justify-content-center align-items-center"
            )}
          >
            {step.completed ? <FaCheck /> : index + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
