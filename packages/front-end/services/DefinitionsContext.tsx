import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { MetricInterface } from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import { ProjectInterface } from "back-end/types/project";
import { useContext, useMemo, createContext, FC, ReactNode } from "react";
import { TagInterface } from "back-end/types/tag";
import { SavedGroupInterface } from "back-end/types/saved-group";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";

type Definitions = {
  metrics: MetricInterface[];
  datasources: DataSourceInterfaceWithParams[];
  dimensions: DimensionInterface[];
  segments: SegmentInterface[];
  projects: ProjectInterface[];
  groups: string[];
  savedGroups: SavedGroupInterface[];
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
  getSavedGroupById: (id: string) => null | SavedGroupInterface;
  getTagById: (id: string) => null | TagInterface;
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
  savedGroups: [],
  projects: [],
  getMetricById: () => null,
  getDatasourceById: () => null,
  getDimensionById: () => null,
  getSegmentById: () => null,
  getProjectById: () => null,
  getSavedGroupById: () => null,
  getTagById: () => null,
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
      // eslint-disable-next-line
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

export const DefinitionsProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
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
  const getSavedGroupById = useGetById(data?.savedGroups);
  const getTagById = useGetById(data?.tags);

  let value: DefinitionContextValue;
  if (error) {
    value = { ...defaultValue, error: error?.message || "" };
  } else if (!data) {
    value = defaultValue;
  } else {
    const filteredProject =
      data.projects && data.projects.map((p) => p.id).includes(project)
        ? project
        : "";
    value = {
      ready: true,
      metrics: activeMetrics,
      datasources: data.datasources,
      dimensions: data.dimensions,
      segments: data.segments,
      tags: data.tags,
      groups: data.groups,
      savedGroups: data.savedGroups,
      projects: data.projects,
      project: filteredProject,
      setProject,
      getMetricById,
      getDatasourceById,
      getDimensionById,
      getSegmentById,
      getProjectById,
      getSavedGroupById,
      getTagById,
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
        const existingTags = data.tags.map((t) => t.id);
        const newTags = tags.filter((t) => !existingTags.includes(t));

        if (newTags.length > 0) {
          await mutate(
            {
              ...data,
              tags: data.tags.concat(
                newTags.map((t) => ({
                  id: t,
                  color: "#029dd1",
                  description: "",
                }))
              ),
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
