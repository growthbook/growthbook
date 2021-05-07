import useApi from "../hooks/useApi";
import { FC, createContext, useContext } from "react";

type WatchContextValue = {
  watching: string[];
  refreshWatching: () => void;
};

const WatchContext = createContext<WatchContextValue>({
  watching: [],
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
  }>("/user/watching");

  const watching = data?.experiments || [];

  return (
    <WatchContext.Provider
      value={{ watching: watching, refreshWatching: mutate }}
    >
      {children}
    </WatchContext.Provider>
  );
};

export default WatchProvider;
