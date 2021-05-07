import { createContext, FC, useContext, useEffect } from "react";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";
import { DimensionInterface } from "back-end/types/dimension";

export type DimensionsContextValue = {
  ready: boolean;
  error?: Error;
  refresh: () => void;
  getDimensionById: (id: string) => null | DimensionInterface;
  dimensions: DimensionInterface[];
};

const DimensionsContext = createContext<DimensionsContextValue>({
  ready: false,
  error: undefined,
  refresh: () => null,
  getDimensionById: () => null,
  dimensions: [],
});

export default DimensionsContext;

export const useDimensions = (): DimensionsContextValue => {
  return useContext(DimensionsContext);
};

export const DimensionsProvider: FC = ({ children }) => {
  const { data, error, mutate } = useApi<{
    dimensions: DimensionInterface[];
  }>(`/dimensions`);

  const { orgId } = useAuth();
  useEffect(() => {
    if (orgId) {
      mutate();
    }
  }, [orgId]);

  const dimensionMap = new Map<string, DimensionInterface>();
  if (data?.dimensions) {
    data.dimensions.forEach((dimension) => {
      dimensionMap.set(dimension.id, dimension);
    });
  }

  const getDimensionById = (id: string) => {
    return dimensionMap.get(id);
  };

  return (
    <DimensionsContext.Provider
      value={{
        ready: data ? true : false,
        error: error,
        refresh: mutate,
        dimensions: data?.dimensions || [],
        getDimensionById,
      }}
    >
      {children}
    </DimensionsContext.Provider>
  );
};
