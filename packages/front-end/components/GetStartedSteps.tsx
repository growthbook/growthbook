import React from "react";
import { FaCheck } from "react-icons/fa";
import { Task } from "./GuidedGetStarted";
import styles from "./GetStartedSteps.module.scss";
import clsx from "clsx";

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
    <div className="d-flex justify-content-center flex-column align-items-center p-4">
      <div className={styles.statusBar}></div>
      <div
        className={clsx(
          "d-flex flex-row justify-content-between p-2",
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
