import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { MetricInterface } from "shared/types/metric";
import { SegmentInterface } from "shared/types/segment";
import { ProjectInterface } from "shared/types/project";
import {
  useContext,
  useMemo,
  createContext,
  FC,
  ReactNode,
  useCallback,
  ReactElement,
  useEffect,
} from "react";
import { TagInterface } from "shared/types/tag";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ExperimentMetricInterface, isFactMetricId } from "shared/experiments";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { CustomField } from "shared/types/custom-fields";
import { DecisionCriteriaInterface } from "shared/types/experiment";
import { WebhookSecretFrontEndInterface } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingOverlay from "@/components/LoadingOverlay";
import { findClosestRadixColor } from "./tags";
import { useUser } from "./UserContext";
import {
  createDummyFactTables,
  createDummyFactMetrics,
} from "./mockData";

type Definitions = {
  metrics: MetricInterface[];
  _metricsIncludingArchived: MetricInterface[];
  datasources: DataSourceInterfaceWithParams[];
  dimensions: DimensionInterface[];
  segments: SegmentInterface[];
  projects: ProjectInterface[];
  savedGroups: SavedGroupWithoutValues[];
  metricGroups: MetricGroupInterface[];
  customFields: CustomField[];
  tags: TagInterface[];
  factTables: FactTableInterface[];
  _factTablesIncludingArchived: FactTableInterface[];
  factMetrics: FactMetricInterface[];
  _factMetricsIncludingArchived: FactMetricInterface[];
  decisionCriteria: DecisionCriteriaInterface[];
  webhookSecrets: WebhookSecretFrontEndInterface[];
};

type DefinitionContextValue = Definitions & {
  ready: boolean;
  error?: string;
  project: string;
  setProject: (id: string) => void;
  refreshTags: (newTags: string[]) => Promise<void>;
  mutateDefinitions: (changes?: Partial<Definitions>) => Promise<void>;
  getMetricById: (id: string) => null | MetricInterface;
  getDatasourceById: (id: string) => null | DataSourceInterfaceWithParams;
  getDimensionById: (id: string) => null | DimensionInterface;
  getSegmentById: (id: string) => null | SegmentInterface;
  getProjectById: (id: string) => null | ProjectInterface;
  getSavedGroupById: (id: string) => null | SavedGroupWithoutValues;
  getTagById: (id: string) => null | TagInterface;
  getFactTableById: (id: string) => null | FactTableInterface;
  getFactMetricById: (id: string) => null | FactMetricInterface;
  getExperimentMetricById: (id: string) => null | ExperimentMetricInterface;
  getMetricGroupById: (id: string) => null | MetricGroupInterface;
  getDecisionCriteriaById: (id: string) => null | DecisionCriteriaInterface;
};

const defaultValue: DefinitionContextValue = {
  ready: false,
  mutateDefinitions: async () => {
    /* do nothing */
  },
  refreshTags: async () => {
    /* do nothing */
  },
  setProject: () => {
    /* do nothing */
  },
  project: "",
  metrics: [],
  _metricsIncludingArchived: [],
  datasources: [],
  dimensions: [],
  segments: [],
  tags: [],
  savedGroups: [],
  metricGroups: [],
  customFields: [],
  projects: [],
  factTables: [],
  _factTablesIncludingArchived: [],
  factMetrics: [],
  _factMetricsIncludingArchived: [],
  decisionCriteria: [],
  webhookSecrets: [],
  getMetricById: () => null,
  getDatasourceById: () => null,
  getDimensionById: () => null,
  getSegmentById: () => null,
  getProjectById: () => null,
  getSavedGroupById: () => null,
  getTagById: () => null,
  getFactTableById: () => null,
  getFactMetricById: () => null,
  getExperimentMetricById: () => null,
  getMetricGroupById: () => null,
  getDecisionCriteriaById: () => null,
};

export const DefinitionsContext =
  createContext<DefinitionContextValue>(defaultValue);

interface IndexableItem {
  id: string;
}
function useGetById<T extends IndexableItem>(
  items?: T[],
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

export const LOCALSTORAGE_PROJECT_KEY = "gb_current_project" as const;

// Applies user's team(s) default project constraint once per browser session
let teamConstraintApplied = false;
function useTeamProjectConstraint() {
  const { user, teams } = useUser();
  const [project, setProject] = useLocalStorage(LOCALSTORAGE_PROJECT_KEY, "");

  useEffect(() => {
    if (!user?.teams || !teams || teamConstraintApplied) return;

    const defaultProjects = new Set<string>();
    (teams || []).forEach((team) => {
      if (team?.defaultProject && user?.teams?.includes(team.id)) {
        defaultProjects.add(team.defaultProject);
      }
    });

    // Apply default project if applicable
    teamConstraintApplied = true;
    if (defaultProjects.size > 0 && !defaultProjects.has(project)) {
      const firstAllowedProject = Array.from(defaultProjects)[0];
      setProject(firstAllowedProject);
    }
  }, [user?.teams, teams, project, setProject]);

  return [project, setProject] as const;
}

export const useProject = () => {
  return useTeamProjectConstraint();
};

export const DefinitionsProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { data, error, mutate } = useApi<Definitions & { status: 200 }>(
    "/organization/definitions",
  );

  const [project, setProject] = useProject();

  const activeMetrics = useMemo(() => {
    if (!data || !data.metrics) {
      return [];
    }
    return data.metrics.filter((m) => m.status !== "archived");
  }, [data?.metrics]);

  const allMetrics = useMemo(() => {
    if (!data || !data.metrics) {
      return [];
    }
    return data.metrics;
  }, [data?.metrics]);

  const metricGroups = useMemo(() => {
    if (!data || !data.metricGroups) {
      return [];
    }
    return data.metricGroups;
  }, [data?.metricGroups]);

  const decisionCriteria = useMemo(() => {
    if (!data || !data.decisionCriteria) {
      return [];
    }
    return data.decisionCriteria;
  }, [data?.decisionCriteria]);

  // Use dummy fact tables and fact metrics instead of real database
  const activeFactTables = useMemo(() => {
    return createDummyFactTables();
  }, []);

  const allFactTables = useMemo(() => {
    return createDummyFactTables();
  }, []);

  const activeFactMetrics = useMemo(() => {
    const dummyMetrics = createDummyFactMetrics();
    return dummyMetrics.filter((m) => !m.archived);
  }, []);

  const allFactMetrics = useMemo(() => {
    return createDummyFactMetrics();
  }, []);

  const allTags = useMemo(() => {
    if (!data || !data.tags) {
      return [];
    }

    return data.tags.map((tag) => {
      if (tag.color.charAt(0) === "#") {
        return { ...tag, color: findClosestRadixColor(tag.color) as string };
      }

      return tag;
    });
  }, [data?.tags]);

  const getMetricById = useGetById(data?.metrics);
  const getDatasourceById = useGetById(data?.datasources);
  const getDimensionById = useGetById(data?.dimensions);
  const getSegmentById = useGetById(data?.segments);
  const getProjectById = useGetById(data?.projects);
  const getSavedGroupById = useGetById(data?.savedGroups);
  const getTagById = useGetById(allTags);
  // Use dummy fact tables and fact metrics instead of data from API
  const getFactTableById = useGetById(allFactTables);
  const getFactMetricById = useGetById(allFactMetrics);

  const getMetricGroupById = useGetById(data?.metricGroups);
  const getDecisionCriteriaById = useGetById(data?.decisionCriteria);

  const getExperimentMetricById = useCallback(
    (id: string) => {
      if (isFactMetricId(id)) {
        return getFactMetricById(id);
      }
      return getMetricById(id);
    },
    [getMetricById, getFactMetricById],
  );

  let value: DefinitionContextValue;
  if (error) {
    value = { 
      ...defaultValue, 
      setProject, 
      error: error?.message || "",
      factTables: activeFactTables,
      _factTablesIncludingArchived: allFactTables,
      factMetrics: activeFactMetrics,
      _factMetricsIncludingArchived: allFactMetrics,
      getFactTableById,
      getFactMetricById,
    };
  } else if (!data) {
    value = {
      ...defaultValue,
      factTables: activeFactTables,
      _factTablesIncludingArchived: allFactTables,
      factMetrics: activeFactMetrics,
      _factMetricsIncludingArchived: allFactMetrics,
      getFactTableById,
      getFactMetricById,
    };
  } else {
    const filteredProject =
      data.projects && data.projects.map((p) => p.id).includes(project)
        ? project
        : "";
    value = {
      ready: true,
      metrics: activeMetrics,
      _metricsIncludingArchived: allMetrics,
      datasources: data.datasources,
      dimensions: data.dimensions,
      segments: data.segments,
      tags: allTags,
      savedGroups: data.savedGroups,
      metricGroups: metricGroups,
      customFields: data.customFields,
      projects: data.projects,
      project: filteredProject,
      factTables: activeFactTables,
      _factTablesIncludingArchived: allFactTables,
      factMetrics: activeFactMetrics,
      _factMetricsIncludingArchived: allFactMetrics,
      decisionCriteria: decisionCriteria,
      webhookSecrets: data.webhookSecrets,
      setProject,
      getMetricById,
      getDatasourceById,
      getDimensionById,
      getSegmentById,
      getProjectById,
      getSavedGroupById,
      getTagById,
      getFactTableById,
      getFactMetricById,
      getExperimentMetricById,
      getMetricGroupById,
      getDecisionCriteriaById,
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
                  color: "blue",
                  description: "",
                })),
              ),
            },
            false,
          );
        }
      },
      mutateDefinitions: async (changes) => {
        await mutate(Object.assign({ ...data }, changes), true);
      },
    };
  }

  return (
    <DefinitionsContext.Provider value={value}>
      {children}
    </DefinitionsContext.Provider>
  );
};

export function DefinitionsGuard({ children }: { children: ReactElement }) {
  const { ready, error } = useDefinitions();

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  return children;
}
