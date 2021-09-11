import * as React from "react";
import type { Experiment, Result } from "@growthbook/js";
import { GrowthBook } from "@growthbook/js";

export { GrowthBook } from "@growthbook/js";

export type {
  Context,
  Experiment,
  Result,
  ExperimentOverride,
} from "@growthbook/js";

export type GrowthBookContextValue = {
  growthbook: GrowthBook;
};
export interface WithRunExperimentProps {
  runExperiment: <T>(exp: Experiment<T>) => Result<T>;
}

export const GrowthBookContext = React.createContext<GrowthBookContextValue>({
  growthbook: new GrowthBook({}),
});

export function useExperiment<T>(exp: Experiment<T>): Result<T> {
  const { growthbook } = React.useContext(GrowthBookContext);
  return growthbook.run(exp);
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
            runExperiment={(exp) => growthbook.run(exp)}
          />
        );
      }}
    </GrowthBookContext.Consumer>
  );
  return withRunExperimentWrapper;
};
withRunExperiment.displayName = "WithRunExperiment";

export const GrowthBookProvider: React.FC<{
  growthbook: GrowthBook;
}> = ({ children, growthbook }) => {
  // Tell growth book how to re-render our app (for dev mode integration)
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
