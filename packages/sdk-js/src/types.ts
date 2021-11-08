import type { GrowthBook } from ".";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

export interface Experiment<T> {
  key: string;
  variations: [T, T, ...T[]];
  weights?: number[];
  status?: "draft" | "running" | "stopped";
  coverage?: number;
  url?: RegExp;
  include?: () => boolean;
  namespace?: [string, number, number];
  groups?: string[];
  force?: number;
  hashAttribute?: string;
}

export type ExperimentOverride = Pick<
  // eslint-disable-next-line
  Experiment<any>,
  "weights" | "status" | "force" | "coverage" | "groups" | "namespace"
> & {
  url?: RegExp | string;
};

export interface Result<T> {
  value: T;
  variationId: number;
  inExperiment: boolean;
  hashAttribute: string;
  hashValue: string;
}

export interface Context {
  enabled?: boolean;
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
  groups?: Record<string, boolean>;
  url?: string;
  overrides?: Record<string, ExperimentOverride>;
  forcedVariations?: Record<string, number>;
  qaMode?: boolean;
  // eslint-disable-next-line
  trackingCallback?: (experiment: Experiment<any>, result: Result<any>) => void;
}

export type SubscriptionFunction = (
  // eslint-disable-next-line
  experiment: Experiment<any>,
  // eslint-disable-next-line
  result: Result<any>
) => void;

export type VariationRange = [number, number];
