import React from "react";
import clsx from "clsx";

export interface StepperProps {
  children: React.ReactNode;
  className?: string;
}

interface StepperStepProps {
  children: React.ReactNode;
}

export function Stepper({ children, className }: StepperProps) {
  return <div className={clsx("stepper", className)}>{children}</div>;
}

export function StepperStep({ children }: StepperStepProps) {
  return (
    <div className="stepper__step">
      <div className="stepper__step-number">
        <span className="stepper__step-number-text">1</span>
      </div>
      <div className="stepper__step-content">{children}</div>
    </div>
  );
}
