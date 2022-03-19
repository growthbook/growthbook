import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { MetricInterface } from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import { ProjectInterface } from "back-end/types/project";
import { useContext, useMemo, createContext, FC } from "react";
import useApi from "../hooks/useApi";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { TagInterface } from "back-end/types/tag";

type Definitions = {
  metrics: MetricInterface[];
  datasources: DataSourceInterfaceWithParams[];
  dimensions: DimensionInterface[];
  segments: SegmentInterface[];
  projects: ProjectInterface[];
  groups: string[];
  tags: TagInterface[];
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

interface IndexableItem {
  id: string;
}
function useGetById<T extends IndexableItem>(
  items?: T[]
): (id: string) => T | null {
  return useMemo(() => {
    if (!items) {
      return () => null;
    }

    const m = new Map<string, T>();
    items.forEach((item) => {
      m.set(item.id, item);
    });
    return (id: string) => {
      return m.get(id) || null;
    };
  }, [items]);
}

export function useDefinitions() {
  return useContext(DefinitionsContext);
}

function transformDataTags(dbTags): TagInterface[] {
  return (
    dbTags?.tags?.map((t) => {
      return {
        name: t,
        color: dbTags?.settings?.[t]?.color ?? "",
        description: dbTags?.settings?.[t]?.description ?? "",
      };
    }) || dbTags
  );
}

export const DefinitionsProvider: FC = ({ children }) => {
  const { data, error, mutate } = useApi<Definitions & { status: 200 }>(
    "/organization/definitions"
  );

  const [project, setProject] = useLocalStorage("gb_current_project", "");

  const activeMetrics = useMemo(() => {
    if (!data || !data.metrics) {
      return [];
    }

    return data.metrics.filter((m) => m.status !== "archived");
  }, [data?.metrics]);

  const getMetricById = useGetById(data?.metrics);
  const getDatasourceById = useGetById(data?.datasources);
  const getDimensionById = useGetById(data?.dimensions);
  const getSegmentById = useGetById(data?.segments);
  const getProjectById = useGetById(data?.projects);

  let value: DefinitionContextValue;
  if (error) {
    value = { ...defaultValue, error: error?.message || "" };
  } else if (!data) {
    value = defaultValue;
  } else {
    value = {
      ready: true,
      metrics: activeMetrics,
      datasources: data.datasources,
      dimensions: data.dimensions,
      segments: data.segments,
      tags: transformDataTags(data.tags),
      groups: data.groups,
      projects: data.projects,
      project:
        data.projects && data.projects.map((p) => p.id).includes(project)
          ? project
          : "",
      setProject,
      getMetricById,
      getDatasourceById,
      getDimensionById,
      getSegmentById,
      getProjectById,
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
        const tagsMap = new Map();
        const dataTags = data?.tags ? transformDataTags(data.tags) : [];
        dataTags.forEach((t) => {
          tagsMap.set(t.name, t);
        });

        const newTags = tags.filter((t) => !tagsMap.has(t));
        if (newTags.length > 0) {
          newTags.forEach((nt) => {
            dataTags.push({ name: nt, color: "", description: "" });
          });
          await mutate(
            {
              ...data,
              tags: [...dataTags],
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
