import { createContext, useContext } from "react";

// Which results design (experiment-results-redesign-v1) a component is in.
export const ResultsRedesignContext = createContext(false);

export function useResultsRedesign(): boolean {
  return useContext(ResultsRedesignContext);
}
