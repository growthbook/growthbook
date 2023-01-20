/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import type {
  Experiment,
  Result,
  FeatureResult,
  JSONValue,
  FeatureDefinition,
  Context,
  WidenPrimitives,
} from "@growthbook/growthbook";
import { GrowthBook } from "@growthbook/growthbook";

export type GrowthBookContextValue = {
  growthbook?: GrowthBook;
};
export interface WithRunExperimentProps {
  runExperiment: <T>(exp: Experiment<T>) => Result<T>;
}
export type GrowthBookSSRData = {
  attributes: Record<string, any>;
  features: Record<string, FeatureDefinition>;
};

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
  return growthbook.evalFeature<T>(id);
}

// Get features from API and targeting attributes during SSR
export async function getGrowthBookSSRData(
  context: Context
): Promise<GrowthBookSSRData> {
  // Server-side GrowthBook instance
  const gb = new GrowthBook({
    ...context,
  });

  // Load feature flags from network if needed
  if (context.clientKey) {
    await gb.loadFeatures();
  }

  const data: GrowthBookSSRData = {
    attributes: gb.getAttributes(),
    features: gb.getFeatures(),
  };
  gb.destroy();

  return data;
}

// Populate the GrowthBook instance in context from the SSR props
export function useGrowthBookSSR(data: GrowthBookSSRData) {
  const gb = useGrowthBook();

  // Only do this once to avoid infinite loops
  const isFirst = React.useRef(true);
  if (gb && isFirst.current) {
    gb.setFeatures(data.features);
    gb.setAttributes(data.attributes);
    isFirst.current = false;
  }
}

export function useExperiment<T>(exp: Experiment<T>): Result<T> {
  const { growthbook } = React.useContext(GrowthBookContext);
  return run(exp, growthbook);
}

export function useFeature<T extends JSONValue = any>(
  id: string
): FeatureResult<T | null> {
  const growthbook = useGrowthBook();
  return feature(id, growthbook);
}

export function useFeatureIsOn(id: string): boolean {
  const growthbook = useGrowthBook();
  return growthbook ? growthbook.isOn(id) : false;
}

export function useFeatureValue<T extends JSONValue = any>(
  id: string,
  fallback: T
): WidenPrimitives<T> {
  const growthbook = useGrowthBook();
  return growthbook
    ? growthbook.getFeatureValue(id, fallback)
    : (fallback as WidenPrimitives<T>);
}

export function useGrowthBook() {
  const { growthbook } = React.useContext(GrowthBookContext);
  return growthbook;
}

export function FeaturesReady({
  children,
  timeout,
  fallback,
}: {
  children: React.ReactNode;
  timeout?: number;
  fallback?: React.ReactNode;
}) {
  const gb = useGrowthBook();
  const [ready, setReady] = React.useState(gb ? gb.ready : false);
  React.useEffect(() => {
    if (timeout && !ready) {
      const timer = setTimeout(() => {
        setReady(true);
      }, timeout);
      return () => clearTimeout(timer);
    }
  }, [timeout, ready]);

  return ready ? children : fallback || null;
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
