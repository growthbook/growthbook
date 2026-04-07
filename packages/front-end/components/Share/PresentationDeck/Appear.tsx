import React from "react";
import { usePresentationStep } from "./PresentationStepContext";

export interface AppearProps {
  index?: number;
  children: React.ReactNode;
}

/**
 * Content that is revealed when the user advances to the next "step" within a slide.
 * First Appear on a slide shows when stepIndex > 0, second when stepIndex > 1, etc.
 * Revealed content fades in.
 */
export function Appear({
  index = 0,
  children,
}: AppearProps): React.ReactElement {
  const { stepIndex } = usePresentationStep();
  if (stepIndex <= index) {
    return <></>;
  }
  return <div className="presentation-appear">{children}</div>;
}
