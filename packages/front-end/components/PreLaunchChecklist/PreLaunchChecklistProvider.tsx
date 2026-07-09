import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { CheckListItem, getChecklistItems } from "./PreLaunchChecklistItems";

interface PreLaunchChecklistContextValue {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  envs: string[];
  checklist: CheckListItem[];
  loading: boolean;
  // null until the checklist data has loaded.
  checklistItemsRemaining: number | null;
  checklistHardBlockerCount: number;
  incompleteChecklistItems: CheckListItem[];
  checklistReady: boolean;
  // Modal state for checklist row actions. The modals themselves are rendered
  // by the checklist UI; this context only owns the open/close state so the
  // onClick handlers baked into the checklist items can toggle them.
  analysisModal: boolean;
  setAnalysisModal: (value: boolean) => void;
  showSdkForm: boolean;
  setShowSdkForm: (value: boolean) => void;
  showScheduleModal: boolean;
  setShowScheduleModal: (value: boolean) => void;
}

const PreLaunchChecklistContext =
  createContext<PreLaunchChecklistContextValue | null>(null);

export function usePreLaunchChecklist(): PreLaunchChecklistContextValue {
  const ctx = useContext(PreLaunchChecklistContext);
  if (!ctx) {
    throw new Error(
      "usePreLaunchChecklist must be used within a PreLaunchChecklistProvider",
    );
  }
  return ctx;
}

export interface PreLaunchChecklistProviderProps {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  editTargeting?: (() => void) | null;
  openSetupTab?: () => void;
  envs: string[];
  children: ReactNode;
}

export function PreLaunchChecklistProvider({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  editTargeting,
  openSetupTab,
  envs,
  children,
}: PreLaunchChecklistProviderProps) {
  const permissionsUtil = usePermissionsUtil();
  const showAnalysisSetupItems = useFeatureIsOn("simple-experiment-flow");
  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  // The pre-launch checklist only applies to draft experiments. Holdouts use a
  // separate launch flow, so skip the fetch + computation for them.
  const isActive =
    experiment.status === "draft" && experiment.type !== "holdout";

  const { data, isLoading } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`, {
    shouldRun: () => isActive,
  });

  // Modal open/close state for checklist row actions. Owned here so the
  // onClick handlers baked into checklist items work regardless of which
  // consumer renders the checklist; the modals are rendered by the checklist UI.
  const [showSdkForm, setShowSdkForm] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [analysisModal, setAnalysisModal] = useState(false);

  const applicableConnections = useMemo(
    () =>
      connections
        .filter(
          (connection) =>
            !connection.projects.length ||
            connection.projects.includes(experiment.project || ""),
        )
        .filter(
          (connection) =>
            !visualChangesets.length || connection.includeVisualExperiments,
        ),
    [connections, experiment.project, visualChangesets.length],
  );

  const checklist: CheckListItem[] = useMemo(() => {
    if (!isActive) return [];
    // Merge the GB checklist items with org's custom checklist items
    return getChecklistItems({
      experiment,
      linkedFeatures,
      visualChangesets,
      checklist: data?.checklist,
      setAnalysisModal: canEditExperiment ? setAnalysisModal : undefined,
      editTargeting,
      openSetupTab,
      checkLinkedChanges: true,
      connections: applicableConnections,
      setShowSdkForm,
      setShowScheduleModal: canEditExperiment
        ? setShowScheduleModal
        : undefined,
      showAnalysisSetupItems,
    });
  }, [
    isActive,
    data,
    editTargeting,
    openSetupTab,
    experiment,
    linkedFeatures,
    visualChangesets,
    canEditExperiment,
    applicableConnections,
    showAnalysisSetupItems,
  ]);

  const incompleteChecklistItems = useMemo(
    () => checklist.filter((item) => item.status === "incomplete"),
    [checklist],
  );

  const checklistItemsRemaining =
    isActive && data ? incompleteChecklistItems.length : null;

  const checklistHardBlockerCount = useMemo(
    () => incompleteChecklistItems.filter((item) => item.hardBlock).length,
    [incompleteChecklistItems],
  );

  const checklistReady = checklistItemsRemaining === 0;

  const value = useMemo<PreLaunchChecklistContextValue>(
    () => ({
      experiment,
      mutateExperiment,
      envs,
      checklist,
      loading: isActive ? !!isLoading : false,
      checklistItemsRemaining,
      checklistHardBlockerCount,
      incompleteChecklistItems,
      checklistReady,
      analysisModal,
      setAnalysisModal,
      showSdkForm,
      setShowSdkForm,
      showScheduleModal,
      setShowScheduleModal,
    }),
    [
      experiment,
      mutateExperiment,
      envs,
      checklist,
      isActive,
      isLoading,
      checklistItemsRemaining,
      checklistHardBlockerCount,
      incompleteChecklistItems,
      checklistReady,
      analysisModal,
      showSdkForm,
      showScheduleModal,
    ],
  );

  return (
    <PreLaunchChecklistContext.Provider value={value}>
      {children}
    </PreLaunchChecklistContext.Provider>
  );
}
