import { createContext, useContext } from "react";

// Apart from AppShell.tsx, which imports every layout, so that what those
// layouts use (AgentPanelContext) can read the decision without a cycle.
export const NewAppShellContext = createContext<boolean | null>(null);

/** Whether the new app shell renders; null until that's decided. */
export function useNewAppShell(): boolean | null {
  return useContext(NewAppShellContext);
}
