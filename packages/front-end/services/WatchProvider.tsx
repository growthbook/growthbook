import useApi from "../hooks/useApi";
import { FC, createContext, useContext } from "react";

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

const WatchProvider: FC = ({ children }) => {
  const { data, mutate } = useApi<{
    experiments: string[];
    features: string[];
  }>("/user/watching");

  const watching = {
    experiments: data?.experiments || [],
    features: data?.features || [],
  };

  return (
    <WatchContext.Provider
      value={{
        watchedExperiments: watching.experiments,
        watchedFeatures: watching.features,
        refreshWatching: mutate,
      }}
    >
      {children}
    </WatchContext.Provider>
  );
};

export default WatchProvider;
