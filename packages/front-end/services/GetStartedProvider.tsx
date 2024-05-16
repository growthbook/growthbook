import { GetStartedChecklist } from "@back-end/types/organization";
import { FC, createContext, useContext, ReactNode, useState } from "react";

type GetStartedValue = {
  currentStep: string;
  stepKey: string;
  source: string;
  clearStep: () => void;
  setStep: ({
    step,
    stepKey,
    source,
  }: {
    step: string;
    stepKey: string;
    source: keyof GetStartedChecklist;
  }) => void;
};

export const routes: Record<keyof GetStartedChecklist, string> = {
  features: "/getstarted/feature-flag-guide",
  experiments: "/getstarted/experiment-guide",
  importedExperiments: "/getstarted/imported-experiment-guide",
};

const GetStartedContext = createContext<GetStartedValue>({
  currentStep: "",
  source: "",
  stepKey: "",
  clearStep: () => {
    // nothing by default
  },
  setStep: () => {
    // nothing by default
  },
});

export const useGetStarted = (): GetStartedValue => {
  return useContext(GetStartedContext);
};

const GetStartedProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [currentStep, setCurrentStep] = useState("");
  const [stepKey, setStepKey] = useState("");
  const [source, setSource] = useState("");

  return (
    <GetStartedContext.Provider
      value={{
        currentStep: currentStep,
        source: source,
        stepKey,
        clearStep: () => {
          setCurrentStep("");
          setSource("");
          setStepKey("");
        },
        setStep: ({ step, source, stepKey }) => {
          setCurrentStep(step);
          setSource(source);
          setStepKey(stepKey);
        },
      }}
    >
      {children}
    </GetStartedContext.Provider>
  );
};

export default GetStartedProvider;
