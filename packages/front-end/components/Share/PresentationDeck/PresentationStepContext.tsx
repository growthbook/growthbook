import { createContext, useContext } from "react";

export interface PresentationStepContextValue {
  stepIndex: number;
  totalSteps: number;
}

const PresentationStepContext = createContext<PresentationStepContextValue>({
  stepIndex: 0,
  totalSteps: 0,
});

export function usePresentationStep() {
  return useContext(PresentationStepContext);
}

export const PresentationStepProvider = PresentationStepContext.Provider;
