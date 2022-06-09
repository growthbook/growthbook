import useApi from "../hooks/useApi";
import { FC, createContext, useContext } from "react";
import { JSONValue } from "@growthbook/growthbook-react";

type WatchContextValue = {
  watching: JSONValue;
  refreshWatching: () => void;
};

const WatchContext = createContext<WatchContextValue>({
  watching: {},
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
      value={{ watching: watching, refreshWatching: mutate }}
    >
      {children}
    </WatchContext.Provider>
  );
};

export default WatchProvider;
