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
  Attributes,
  RegisteredFeatures,
  RegisteredAttributes,
  BundledFeatureKey,
} from "@growthbook/growthbook";
import { GrowthBook } from "@growthbook/growthbook";

export type GrowthBookContextValue = {
  growthbook: GrowthBook;
};
export interface WithRunExperimentProps {
  runExperiment: <T>(exp: Experiment<T>) => Result<T>;
}
/** @deprecated */
export type GrowthBookSSRData = {
  attributes: Record<string, any>;
  features: Record<string, FeatureDefinition>;
};

export const GrowthBookContext = React.createContext<GrowthBookContextValue>(
  {} as GrowthBookContextValue,
);

/** @deprecated */
export async function getGrowthBookSSRData(
  context: Context,
): Promise<GrowthBookSSRData> {
  // Server-side GrowthBook instance
  const gb = new GrowthBook({
    ...context,
  });

  // Load feature flags from network if needed
  if (context.clientKey) {
    await gb.init();
  }

  const data: GrowthBookSSRData = {
    attributes: gb.getAttributes(),
    features: gb.getFeatures(),
  };
  gb.destroy();

  return data;
}

/** @deprecated */
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
  return growthbook.run(exp);
}

// Feature keys default to the types registered on the SDK's `Register` interface
type FeatureKey = string & keyof RegisteredFeatures;
// Stops `id` from being used to infer AppFeatures, which would accept any key
type NoInferType<T> = [T][T extends unknown ? 0 : never];

// `useFeature<number>("key")` still works; without the generic, the registered type is used
export function useFeature<
  V extends JSONValue = never,
  K extends FeatureKey = FeatureKey,
>(
  id: K,
): FeatureResult<([V] extends [never] ? RegisteredFeatures[K] : V) | null> {
  return useGrowthBook().evalFeature(id);
}

export function useFeatureIsOn<
  AppFeatures extends Record<string, any> = RegisteredFeatures,
>(id: string & keyof NoInferType<AppFeatures>): boolean {
  const growthbook = useGrowthBook<AppFeatures>();
  return growthbook.isOn(id as string & keyof AppFeatures);
}

// The fallback is optional for a feature with a default in the registered payload
export function useFeatureValue<K extends BundledFeatureKey & FeatureKey>(
  id: K,
): RegisteredFeatures[K];
export function useFeatureValue<
  V extends RegisteredFeatures[K],
  K extends FeatureKey = FeatureKey,
>(id: K, fallback: V): WidenPrimitives<V>;
export function useFeatureValue(id: string, fallback?: unknown): unknown {
  return useGrowthBook<Record<string, any>>().getFeatureValue(id, fallback);
}

export function useGrowthBook<
  AppFeatures extends Record<string, any> = RegisteredFeatures,
  AppAttributes extends Attributes = RegisteredAttributes,
>(): GrowthBook<AppFeatures, AppAttributes> {
  const { growthbook } = React.useContext(GrowthBookContext);

  if (!growthbook) {
    throw new Error("Missing or invalid GrowthBookProvider");
  }

  return growthbook as GrowthBook<AppFeatures, AppAttributes>;
}

export function FeaturesReady({
  children,
  timeout,
  fallback,
}: {
  children: React.ReactNode;
  timeout?: number;
  fallback?: React.ReactNode;
}): React.ReactElement {
  const gb = useGrowthBook();
  const [hitTimeout, setHitTimeout] = React.useState(false);
  const ready = gb ? gb.ready : false;
  React.useEffect(() => {
    if (timeout && !ready) {
      const timer = setTimeout(() => {
        gb &&
          gb.log("FeaturesReady timed out waiting for features to load", {
            timeout,
          });
        setHitTimeout(true);
      }, timeout);
      return () => clearTimeout(timer);
    }
  }, [timeout, ready, gb]);

  return <>{ready || hitTimeout ? children : fallback || null}</>;
}

export function IfFeatureEnabled({
  children,
  feature,
}: {
  children: React.ReactNode;
  feature: FeatureKey;
}): React.ReactElement | null {
  return useFeature(feature).on ? <>{children}</> : null;
}

export function FeatureString(props: {
  default: string;
  feature: FeatureKey;
}): React.ReactElement {
  const value = useFeature(props.feature).value;

  if (value !== null) {
    return <>{value}</>;
  }

  return <>{props.default}</>;
}

export const withRunExperiment = <P extends WithRunExperimentProps>(
  Component: React.ComponentType<P>,
): React.ComponentType<Omit<P, keyof WithRunExperimentProps>> => {
  const withRunExperimentWrapper = (props: any): React.ReactElement => (
    <GrowthBookContext.Consumer>
      {({ growthbook }): React.ReactElement => {
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

export const GrowthBookProvider: React.FC<
  React.PropsWithChildren<{
    // Any instance, so one typed with its own generics still works when
    // different types are registered
    growthbook: GrowthBook<any, any>;
  }>
> = ({ children, growthbook }) => {
  // Tell growthbook how to re-render our app (for dev mode integration)

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
