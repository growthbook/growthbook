import { createContext, FC, useState, useEffect } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";

export type DatasourceContextValue = {
  ready: boolean;
  error?: Error;
  refresh: () => void;
  getById: (id: string) => Partial<DataSourceInterfaceWithParams> | undefined;
  datasources: Partial<DataSourceInterfaceWithParams>[];
};

const DatasourceContext = createContext<DatasourceContextValue>({
  ready: false,
  error: undefined,
  refresh: undefined,
  getById: undefined,
  datasources: [],
});

export default DatasourceContext;

export const DataSourceProvider: FC = ({ children }) => {
  const [current, setCurrent] = useState<string>(undefined);

  const { data, error, mutate } = useApi<{
    datasources: Partial<DataSourceInterfaceWithParams>[];
  }>(`/datasources`);

  const { orgId } = useAuth();
  useEffect(() => {
    if (orgId) {
      mutate();
      setCurrent(undefined);
    }
  }, [orgId]);

  useEffect(() => {
    if (current === undefined && data && data.datasources[0]) {
      setCurrent(data.datasources[0].id);
    }
  }, [data]);

  const getById = (id: string) => {
    return data ? data.datasources.filter((d) => d.id === id)[0] : undefined;
  };

  return (
    <DatasourceContext.Provider
      value={{
        ready: data ? true : false,
        error: error,
        getById,
        refresh: mutate,
        datasources: data ? data.datasources : [],
      }}
    >
      {children}
    </DatasourceContext.Provider>
  );
};
