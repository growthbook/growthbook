import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { MetricInterface } from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import { ProjectInterface } from "back-end/types/project";
import { useContext } from "react";
import { createContext, FC } from "react";
import useApi from "../hooks/useApi";
import { useLocalStorage } from "../hooks/useLocalStorage";

type Definitions = {
  metrics: MetricInterface[];
  datasources: DataSourceInterfaceWithParams[];
  dimensions: DimensionInterface[];
  segments: SegmentInterface[];
  projects: ProjectInterface[];
  groups: string[];
  tags: string[];
};

type DefinitionContextValue = Definitions & {
  ready: boolean;
  error?: string;
  project: string;
  setProject: (id: string) => void;
  refreshTags: (newTags: string[]) => Promise<void>;
  refreshGroups: (newGroups: string[]) => Promise<void>;
  mutateDefinitions: (changes?: Partial<Definitions>) => Promise<void>;
  getMetricById: (id: string) => null | MetricInterface;
  getDatasourceById: (id: string) => null | DataSourceInterfaceWithParams;
  getDimensionById: (id: string) => null | DimensionInterface;
  getSegmentById: (id: string) => null | SegmentInterface;
  getProjectById: (id: string) => null | ProjectInterface;
};

const defaultValue: DefinitionContextValue = {
  ready: false,
  mutateDefinitions: async () => {
    /* do nothing */
  },
  refreshTags: async () => {
    /* do nothing */
  },
  refreshGroups: async () => {
    /* do nothing */
  },
  setProject: () => {
    /* do nothing */
  },
  project: "",
  metrics: [],
  datasources: [],
  dimensions: [],
  segments: [],
  tags: [],
  groups: [],
  projects: [],
  getMetricById: () => null,
  getDatasourceById: () => null,
  getDimensionById: () => null,
  getSegmentById: () => null,
  getProjectById: () => null,
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
  const { data, error, mutate } = useApi<Definitions & { status: 200 }>(
    "/organization/definitions"
  );

  const [project, setProject] = useLocalStorage("gb_current_project", "");

  let value: DefinitionContextValue;
  if (error) {
    value = { ...defaultValue, error: error?.message || "" };
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
      projects: data.projects,
      project:
        data.projects && data.projects.map((p) => p.id).includes(project)
          ? project
          : "",
      setProject,
      getMetricById: getByIdFunction(data.metrics),
      getDatasourceById: getByIdFunction(data.datasources),
      getDimensionById: getByIdFunction(data.dimensions),
      getSegmentById: getByIdFunction(data.segments),
      getProjectById: getByIdFunction(data.projects),
      refreshGroups: async (groups) => {
        const newGroups = groups.filter((t) => !data.groups.includes(t));
        if (newGroups.length > 0) {
          await mutate(
            {
              ...data,
              groups: data.groups.concat(newGroups),
            },
            false
          );
        }
      },
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
        await mutate(Object.assign({ status: 200, ...data }, changes), true);
      },
    };
  }

  return (
    <DefinitionsContext.Provider value={value}>
      {children}
    </DefinitionsContext.Provider>
  );
};
