import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import useApi from "@/hooks/useApi";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import { CheckListItem, getChecklistItems } from "./PreLaunchChecklistItems";
import { ChecklistSummary, summarizeChecklist } from "./checklistSummary";
import { useManualChecklistToggle } from "./useManualChecklistToggle";

interface PreLaunchChecklistContextValue {
  experiment: ExperimentInterfaceStringDates;
  // A draft that isn't a holdout: nothing to check off otherwise.
  active: boolean;
  checklist: CheckListItem[];
  summary: ChecklistSummary;
  loading: boolean;
  // The custom checklist didn't load; the built-in items still show.
  loadError: boolean;
  // null only while an active checklist is still loading.
  checklistItemsRemaining: number | null;
  checklistHardBlockerCount: number;
  checklistReady: boolean;
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

/** The checklist's summary, less the rows a surface shows its own way. */
export function useChecklistSummary(
  omit?: (item: CheckListItem) => boolean,
): ChecklistSummary {
  const { checklist, summary } = usePreLaunchChecklist();
  return omit
    ? summarizeChecklist(checklist.filter((item) => !omit(item)))
    : summary;
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
  editVariationValues?: () => void;
  openImplementation?: () => void;
  openAnalysisSettings?: () => void;
  openManagedApproval?: () => void;
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
  editVariationValues,
  openImplementation,
  openAnalysisSettings,
  openManagedApproval,
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

  const { data, error } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`, {
    shouldRun: () => isActive,
  });
  const { data: sdkData, error: sdkError } = useSDKConnections();
  // Counting before both arrive would count the SDK Connection row as missing.
  const loading = isActive && ((!data && !error) || (!sdkData && !sdkError));

  const [showSdkForm, setShowSdkForm] = useState(false);

  const projectConnections = useMemo(
    () =>
      (sdkData?.connections ?? []).filter(
        (connection) =>
          !connection.projects.length ||
          connection.projects.includes(experiment.project || ""),
      ),
    [sdkData, experiment.project],
  );

  const checklist: CheckListItem[] = useMemo(() => {
    if (!isActive) return [];
    // Merge the GB checklist items with org's custom checklist items
    return getChecklistItems({
      experiment,
      linkedFeatures,
      visualChangesets,
      urlRedirects,
      checklist: data?.checklist,
      connections: projectConnections,
      // The Bandit card edits only with the targeting editor's permission.
      openAnalysisSettings:
        canEdit && (!isBandit || editTargeting) ? openAnalysisSettings : null,
      openImplementation: canEdit ? openImplementation : null,
      editVariationValues: canEdit ? editVariationValues : null,
      openManagedApproval,
      editTargeting,
      editSchedule: canEdit ? editSchedule : null,
      createSdkConnection: canCreateSdkConnection
        ? () => setShowSdkForm(true)
        : null,
    });
  }, [
    isActive,
    data,
    experiment,
    linkedFeatures,
    visualChangesets,
    urlRedirects,
    projectConnections,
    canEdit,
    isBandit,
    editTargeting,
    openAnalysisSettings,
    openImplementation,
    editVariationValues,
    openManagedApproval,
    editSchedule,
    canCreateSdkConnection,
  ]);

  const summary = useMemo(() => summarizeChecklist(checklist), [checklist]);
  const checklistItemsRemaining = loading ? null : summary.remaining;

  const { toggle, error: toggleError } = useManualChecklistToggle(
    experiment,
    mutateExperiment,
  );

  const value = useMemo<PreLaunchChecklistContextValue>(
    () => ({
      experiment,
      active: isActive,
      checklist,
      summary,
      loading,
      loadError: isActive && !!error,
      checklistItemsRemaining,
      checklistHardBlockerCount: summary.blocking,
      checklistReady: checklistItemsRemaining === 0,
      toggleManualItem: canEdit ? toggle : null,
      toggleError,
    }),
    [
      experiment,
      isActive,
      checklist,
      summary,
      loading,
      error,
      checklistItemsRemaining,
      canEdit,
      toggle,
      toggleError,
    ],
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
