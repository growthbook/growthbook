import {
  FC,
  createContext,
  useContext,
  ReactNode,
  useState,
  useCallback,
} from "react";

type GetStartedChecklistSource =
  | "featureFlagGuide"
  | "experimentGuide"
  | "importedExperimentGuide"
  | "dataSourceGuide";

type GetStartedValue = {
  currentStep: string;
  stepKey: string;
  source: string;
  sourceParams: string;
  getReturnUrl: () => string;
  clearStep: () => void;
  setStep: ({
    step,
    stepKey,
    source,
    sourceParams,
  }: {
    step: string;
    stepKey: string;
    source: GetStartedChecklistSource;
    sourceParams?: string;
  }) => void;
};

const routes: Record<GetStartedChecklistSource, string> = {
  featureFlagGuide: "/getstarted/feature-flag-guide",
  experimentGuide: "/getstarted/experiment-guide",
  importedExperimentGuide: "/getstarted/imported-experiment-guide",
  dataSourceGuide: "/getstarted/data-source-guide",
};

const GetStartedContext = createContext<GetStartedValue>({
  currentStep: "",
  source: "",
  sourceParams: "",
  getReturnUrl: () => "",
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
  const [sourceParams, setSourceParams] = useState("");

  const clearStep = useCallback(() => {
    setCurrentStep("");
    setSource("");
    setSourceParams("");
    setStepKey("");
  }, []);
  const setStep = useCallback(({ step, source, sourceParams, stepKey }) => {
    setCurrentStep(step);
    setSource(source);
    if (sourceParams) setSourceParams(sourceParams);
    setStepKey(stepKey);
  }, []);
  const getReturnUrl = useCallback(() => {
    return `${routes[source]}${sourceParams ? `?${sourceParams}` : ""}`;
  }, [source, sourceParams]);

  return (
    <GetStartedContext.Provider
      value={{
        currentStep,
        source,
        sourceParams,
        getReturnUrl,
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
