import * as React from "react";
import type { Experiment, Result } from "@growthbook/growthbook";
import { GrowthBook } from "@growthbook/growthbook";

export { GrowthBook } from "@growthbook/growthbook";

export type {
  Context,
  Experiment,
  Result,
  ExperimentOverride,
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
      value: exp.variations[0],
      variationId: 0,
      inExperiment: false,
      hashAttribute: exp.hashAttribute || "id",
      hashValue: "",
    };
  }
  return growthbook.run(exp);
}

export function useExperiment<T>(exp: Experiment<T>): Result<T> {
  const { growthbook } = React.useContext(GrowthBookContext);
  return run(exp, growthbook);
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

export const GrowthBookProvider: React.FC<{
  growthbook?: GrowthBook;
}> = ({ children, growthbook }) => {
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
