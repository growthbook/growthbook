import { createContext, useContext } from "react";

// Which feature page design (feature-page-redesign-v1) a component is in.
export const FeaturePageRedesignContext = createContext(true);

export function useFeaturePageRedesign(): boolean {
  return useContext(FeaturePageRedesignContext);
}
