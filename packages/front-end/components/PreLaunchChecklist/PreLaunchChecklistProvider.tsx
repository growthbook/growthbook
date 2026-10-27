import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { sdkConnectionServesProject } from "shared/experiments";
import {
  createContext,
  ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import useApi from "@/hooks/useApi";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import { getChecklistItems } from "./PreLaunchChecklistItems";
import { ChecklistSummary, summarizeChecklist } from "./checklistSummary";
import { useManualChecklistToggle } from "./useManualChecklistToggle";

interface PreLaunchChecklistContextValue {
  // A draft that isn't a holdout: nothing to check off otherwise.
  active: boolean;
  summary: ChecklistSummary;
  loading: boolean;
  // The custom checklist didn't load; the built-in items still show.
  loadError: boolean;
  // null only while an active checklist is still loading.
  checklistItemsRemaining: number | null;
  // null when the viewer can't check tasks off.
  toggleManualItem: ((manualKey: string, checked: boolean) => void) | null;
  toggleError: string | null;
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

/** The org's custom checklist and the project's SDK Connections. */
export function useLaunchChecklistData(
  experiment: ExperimentInterfaceStringDates,
  enabled = true,
) {
  const { data, error } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`, {
    shouldRun: () => enabled,
  });
  const { data: sdkData, error: sdkError } = useSDKConnections();
  const connections = useMemo(
    () =>
      (sdkData?.connections ?? []).filter((connection) =>
        sdkConnectionServesProject(connection, experiment.project),
      ),
    [sdkData, experiment.project],
  );
  return {
    checklist: data?.checklist,
    connections,
    // Counting before both arrive would count the SDK Connection row as missing.
    loading: enabled && ((!data && !error) || (!sdkData && !sdkError)),
    loadError: enabled && !!error,
  };
}

export interface PreLaunchChecklistProviderProps {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  canEdit: boolean;
  editTargeting?: (() => void) | null;
  editSchedule?: (() => void) | null;
  openImplementation?: () => void;
  openAnalysisSettings?: (focus: AnalysisFormFocus | null) => void;
  children: ReactNode;
}

export function PreLaunchChecklistProvider({
  experiment,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  mutateExperiment,
  canEdit,
  editTargeting,
  editSchedule,
  openImplementation,
  openAnalysisSettings,
  children,
}: PreLaunchChecklistProviderProps) {
  const permissionsUtil = usePermissionsUtil();
  const canCreateSdkConnection =
    permissionsUtil.canViewCreateSDKConnectionModal(experiment.project);
  const isBandit = experiment.type === "multi-armed-bandit";

  // The pre-launch checklist only applies to draft experiments. Holdouts use a
  // separate launch flow, so skip the fetch + computation for them.
  const isActive =
    experiment.status === "draft" && experiment.type !== "holdout";

  const { checklist, connections, loading, loadError } = useLaunchChecklistData(
    experiment,
    isActive,
  );

  const [showSdkForm, setShowSdkForm] = useState(false);

  // Read at click time, so a parent's inline handlers don't rebuild the list.
  const handlers = useRef<
    Pick<
      PreLaunchChecklistProviderProps,
      | "openAnalysisSettings"
      | "openImplementation"
      | "editTargeting"
      | "editSchedule"
    >
  >({});
  handlers.current = {
    openAnalysisSettings,
    openImplementation,
    editTargeting,
    editSchedule,
  };
  // The Bandit card edits only with the targeting editor's permission.
  const canOpenAnalysis =
    canEdit && !!openAnalysisSettings && (!isBandit || !!editTargeting);
  const canOpenImplementation = canEdit && !!openImplementation;
  const canEditTargeting = !!editTargeting;
  const canEditSchedule = canEdit && !!editSchedule;

  // Merge the GB checklist items with org's custom checklist items
  const summary = useMemo(
    () =>
      summarizeChecklist(
        isActive
          ? getChecklistItems({
              experiment,
              linkedFeatures,
              visualChangesets,
              urlRedirects,
              checklist,
              connections,
              openAnalysisSettings: canOpenAnalysis
                ? (focus) => handlers.current.openAnalysisSettings?.(focus)
                : null,
              openImplementation: canOpenImplementation
                ? () => handlers.current.openImplementation?.()
                : null,
              editTargeting: canEditTargeting
                ? () => handlers.current.editTargeting?.()
                : null,
              editSchedule: canEditSchedule
                ? () => handlers.current.editSchedule?.()
                : null,
              createSdkConnection: canCreateSdkConnection
                ? () => setShowSdkForm(true)
                : null,
            })
          : [],
      ),
    [
      isActive,
      experiment,
      linkedFeatures,
      visualChangesets,
      urlRedirects,
      checklist,
      connections,
      canOpenAnalysis,
      canOpenImplementation,
      canEditTargeting,
      canEditSchedule,
      canCreateSdkConnection,
    ],
  );

  const { toggle, error: toggleError } = useManualChecklistToggle(
    experiment,
    mutateExperiment,
  );

  const value = useMemo<PreLaunchChecklistContextValue>(
    () => ({
      active: isActive,
      summary,
      loading,
      loadError,
      checklistItemsRemaining: loading ? null : summary.remaining,
      toggleManualItem: canEdit ? toggle : null,
      toggleError,
    }),
    [isActive, summary, loading, loadError, canEdit, toggle, toggleError],
  );

  return (
    <PreLaunchChecklistContext.Provider value={value}>
      {showSdkForm ? (
        <InitialSDKConnectionForm
          close={() => setShowSdkForm(false)}
          includeCheck={true}
          cta="Continue"
          goToNextStep={() => setShowSdkForm(false)}
        />
      ) : null}
      {children}
    </PreLaunchChecklistContext.Provider>
  );
}
