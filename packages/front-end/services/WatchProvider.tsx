import { FC, createContext, useContext, ReactNode } from "react";
import { useUser } from "./UserContext";

type WatchContextValue = {
  watchedExperiments: string[];
  watchedFeatures: string[];
  refreshWatching: () => void;
};

const WatchContext = createContext<WatchContextValue>({
  watchedExperiments: [],
  watchedFeatures: [],
  refreshWatching: () => {
    // nothing by default
  },
});

export const useWatching = (): WatchContextValue => {
  return useContext(WatchContext);
};

const WatchProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { refreshOrganization, watching } = useUser();

  return (
    <WatchContext.Provider
      value={{
        watchedExperiments: watching.experiments,
        watchedFeatures: watching.features,
        refreshWatching: refreshOrganization,
      }}
    >
      {children}
    </WatchContext.Provider>
  );
};

export default WatchProvider;
