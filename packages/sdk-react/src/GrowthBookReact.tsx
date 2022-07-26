/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import type {
  Experiment,
  Result,
  FeatureResult,
  JSONValue,
  GrowthBook,
} from "@growthbook/growthbook";

export type GrowthBookContextValue = {
  growthbook?: GrowthBook;
};
export interface WithRunExperimentProps {
  runExperiment: <T>(exp: Experiment<T>) => Result<T>;
}

export const GrowthBookContext = React.createContext<GrowthBookContextValue>(
  {}
);

function run<T>(exp: Experiment<T>, growthbook?: GrowthBook): Result<T> {
  if (!growthbook) {
    return {
      featureId: null,
      value: exp.variations[0],
      variationId: 0,
      inExperiment: false,
      hashUsed: false,
      hashAttribute: exp.hashAttribute || "id",
      hashValue: "",
    };
  }
  return growthbook.run(exp);
}
function feature<T extends JSONValue = any>(
  id: string,
  growthbook?: GrowthBook
): FeatureResult<T | null> {
  if (!growthbook) {
    return {
      value: null,
      on: false,
      off: true,
      source: "unknownFeature",
      ruleId: "",
    };
  }
  return growthbook.feature<T>(id);
}

export function useExperiment<T>(exp: Experiment<T>): Result<T> {
  const { growthbook } = React.useContext(GrowthBookContext);
  return run(exp, growthbook);
}

export function useFeature<T extends JSONValue = any>(
  id: string
): FeatureResult<T | null> {
  const { growthbook } = React.useContext(GrowthBookContext);
  return feature(id, growthbook);
}

export function useGrowthBook() {
  const { growthbook } = React.useContext(GrowthBookContext);
  return growthbook;
}

export function IfFeatureEnabled({
  children,
  feature,
}: {
  children: React.ReactNode;
  feature: string;
}) {
  return useFeature(feature).on ? <>{children}</> : null;
}

export function FeatureString(props: { default: string; feature: string }) {
  const value = useFeature(props.feature).value;

  if (value !== null) {
    return <>{value}</>;
  }

  return <>{props.default}</>;
}

export const withRunExperiment = <P extends WithRunExperimentProps>(
  Component: React.ComponentType<P>
): React.ComponentType<Omit<P, keyof WithRunExperimentProps>> => {
  // eslint-disable-next-line
  const withRunExperimentWrapper = (props: any): JSX.Element => (
    <GrowthBookContext.Consumer>
      {({ growthbook }): JSX.Element => {
        return (
          <Component
            {...(props as P)}
            runExperiment={(exp) => run(exp, growthbook)}
          />
        );
      }}
    </GrowthBookContext.Consumer>
  );
  return withRunExperimentWrapper;
};
withRunExperiment.displayName = "WithRunExperiment";

export const GrowthBookProvider: React.FC<
  React.PropsWithChildren<{
    growthbook?: GrowthBook;
  }>
> = ({ children, growthbook }) => {
  // Tell growthbook how to re-render our app (for dev mode integration)
  // eslint-disable-next-line
  const [_, setRenderCount] = React.useState(0);
  React.useEffect(() => {
    if (!growthbook || !growthbook.setRenderer) return;

    growthbook.setRenderer(() => {
      setRenderCount((v) => v + 1);
    });
    return () => {
      growthbook.setRenderer(() => {
        // do nothing
      });
    };
  }, [growthbook]);

  return (
    <GrowthBookContext.Provider
      value={{
        growthbook,
      }}
    >
      {children}
    </GrowthBookContext.Provider>
  );
};
