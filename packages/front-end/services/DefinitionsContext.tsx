import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { MetricInterface } from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import { useContext } from "react";
import { createContext, FC } from "react";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";

type Definitions = {
  metrics: MetricInterface[];
  datasources: DataSourceInterfaceWithParams[];
  dimensions: DimensionInterface[];
  segments: SegmentInterface[];
  groups: string[];
  tags: string[];
};

type DefinitionContextValue = Definitions & {
  ready: boolean;
  error?: string;
  refreshTags: (newTags: string[]) => Promise<void>;
  mutateDefinitions: (changes?: Partial<Definitions>) => Promise<void>;
  getMetricById: (id: string) => null | MetricInterface;
  getDatasourceById: (id: string) => null | DataSourceInterfaceWithParams;
  getDimensionById: (id: string) => null | DimensionInterface;
  getSegmentById: (id: string) => null | SegmentInterface;
};

const defaultValue: DefinitionContextValue = {
  ready: false,
  mutateDefinitions: async () => {
    /* do nothing */
  },
  refreshTags: async () => {
    /* do nothing */
  },
  metrics: [],
  datasources: [],
  dimensions: [],
  segments: [],
  tags: [],
  groups: [],
  getMetricById: () => null,
  getDatasourceById: () => null,
  getDimensionById: () => null,
  getSegmentById: () => null,
};

export const DefinitionsContext = createContext<DefinitionContextValue>(
  defaultValue
);

function getByIdFunction<T extends { id: string }>(list: T[]) {
  return (id: string) => list.filter((l) => l.id === id)[0] || null;
}

export function useDefinitions() {
  return useContext(DefinitionsContext);
}

export const DefinitionsProvider: FC = ({ children }) => {
  const { orgId } = useAuth();
  const { data, error, mutate } = useApi<Definitions & { status: 200 }>(
    "/organization/definitions?orgId=" + orgId
  );

  let value: DefinitionContextValue;
  if (error) {
    value = { ...defaultValue, error: error?.message || error };
  } else if (!data) {
    value = defaultValue;
  } else {
    value = {
      ready: true,
      metrics: data.metrics,
      datasources: data.datasources,
      dimensions: data.dimensions,
      segments: data.segments,
      tags: data.tags,
      groups: data.groups,
      getMetricById: getByIdFunction(data.metrics),
      getDatasourceById: getByIdFunction(data.datasources),
      getDimensionById: getByIdFunction(data.dimensions),
      getSegmentById: getByIdFunction(data.segments),
      refreshTags: async (tags) => {
        const newTags = tags.filter((t) => !data.tags.includes(t));
        if (newTags.length > 0) {
          await mutate(
            {
              ...data,
              tags: data.tags.concat(newTags),
            },
            false
          );
        }
      },
      mutateDefinitions: async (changes) => {
        await mutate(Object.assign({ status: 200, ...data }, changes));
      },
    };
  }

  return (
    <DefinitionsContext.Provider value={value}>
      {children}
    </DefinitionsContext.Provider>
  );
};
