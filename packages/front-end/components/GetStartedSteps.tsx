import React from "react";
import { FaCheck } from "react-icons/fa";
import { Task } from "./GuidedGetStarted";

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
      <div
        style={{
          height: "4px",
          width: "55%",
          backgroundColor: "#7C45E9",
          position: "relative",
          top: "34px",
          zIndex: 1,
        }}
      ></div>
      <div
        className="d-flex flex-row justify-content-between p-2"
        style={{ width: "60%" }}
      >
        {steps.map((step, index) => (
          <div
            role="button"
            onClick={() => {
              setCurrentStep(index);
            }}
            key={index}
            className="p-3 d-flex justify-content-center align-items-center"
            style={{
              color:
                currentStep === index || !step.completed ? "#7C45E9" : "white",
              backgroundColor:
                currentStep === index
                  ? "#E2DDF9"
                  : step.completed
                  ? "#7C45E9"
                  : "white",
              fontWeight: "bold",
              borderRadius: "50%",
              outline: "4px solid #7C45E9",
              width: "43px",
              height: "43px",
              boxShadow: "#9D9D9D 4px 4px 12px 0px",
              zIndex: 3,
              boxSizing: "border-box",
            }}
          >
            {step.completed ? <FaCheck /> : index + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
