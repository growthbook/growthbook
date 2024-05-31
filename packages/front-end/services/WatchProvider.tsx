import { FC, createContext, useContext, ReactNode, useMemo } from "react";
import useApi from "@/hooks/useApi";

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
  const { data, mutate } = useApi<{
    experiments: string[];
    features: string[];
  }>("/user/watching");

  const watching = useMemo(() => {
    return {
      experiments: data?.experiments || [],
      features: data?.features || [],
    };
  }, [data]);

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
