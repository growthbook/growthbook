import { createContext, useContext } from "react";

// Which design of the feature page a component sits in, while the redesign is
// tested against the page it replaces (feature-page-redesign-v1). Anywhere
// else, the redesign.
export const FeaturePageRedesignContext = createContext(true);

export function useFeaturePageRedesign(): boolean {
  return useContext(FeaturePageRedesignContext);
}
