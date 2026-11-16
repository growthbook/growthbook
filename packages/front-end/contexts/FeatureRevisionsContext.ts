import { createContext, useContext } from "react";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

export interface FeatureRevisionsContextValue {
  /** All full revision objects available on the feature page. */
  revisions: FeatureRevisionInterface[];
  /** Raw live feature document (un-merged with any draft). */
  baseFeature: FeatureInterface;
  /** The revision version currently selected / being viewed on the feature page. */
  currentVersion: number;
  /**
   * Loads full revisions into `revisions`, the page's one cache. `force`
   * reloads ones already there.
   */
  loadRevisions: (
    versions: number[],
    options?: { force?: boolean },
  ) => Promise<void>;
  /** Versions the last load didn't return (gone, or the request failed). */
  unavailableVersions: Set<number>;
}

export const FeatureRevisionsContext =
  createContext<FeatureRevisionsContextValue | null>(null);

/** Returns the feature-page revision context, or null if used outside the provider. */
export function useFeatureRevisionsContext(): FeatureRevisionsContextValue | null {
  return useContext(FeatureRevisionsContext);
}
