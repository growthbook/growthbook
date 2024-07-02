import {
  FC,
  createContext,
  useContext,
  ReactNode,
  useState,
  useCallback,
} from "react";

type GetStartedChecklistSource =
  | "features"
  | "experiments"
  | "importedExperiments";

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
    source: GetStartedChecklistSource;
  }) => void;
};

export const routes: Record<GetStartedChecklistSource, string> = {
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

  const clearStep = useCallback(() => {
    setCurrentStep("");
    setSource("");
    setStepKey("");
  }, []);
  const setStep = useCallback(({ step, source, stepKey }) => {
    setCurrentStep(step);
    setSource(source);
    setStepKey(stepKey);
  }, []);

  return (
    <GetStartedContext.Provider
      value={{
        currentStep: currentStep,
        source: source,
        stepKey,
        clearStep,
        setStep,
      }}
    >
      {children}
    </GetStartedContext.Provider>
  );
};

export default GetStartedProvider;
