import { createContext, useContext } from "react";

// The experiment's own Feature Flag reviews and refreshes on the experiment,
// not its flag page, which refuses writes.
type ManagedFlagContextValue = {
  // null until there's a review to open.
  openReview: (() => void) | null;
  mutate: () => void;
};

const ManagedFlagContext = createContext<ManagedFlagContextValue>({
  openReview: null,
  mutate: () => undefined,
});

export const ManagedFlagProvider = ManagedFlagContext.Provider;

export function useManagedFlagContext() {
  return useContext(ManagedFlagContext);
}
