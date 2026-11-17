import { useEffect } from "react";
import { getSnapshotAnalysis } from "shared/util";
import { getMetricRefresh } from "shared/experiments";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import { analysisUpdate } from "@/services/snapshots";

// A metric refresh's analyses use the experiment's current default settings,
// which differ from the base's once a goal metric is added (numGoalMetrics).
export function useSelectedAnalysisOnMetricRefresh(onFailure: () => void) {
  const { apiCall } = useAuth();
  const { snapshot, analysisSettings, setAnalysisSettings, phase, mutate } =
    useSnapshot();

  useEffect(() => {
    if (!snapshot || !getMetricRefresh(snapshot) || !analysisSettings) return;
    if (getSnapshotAnalysis(snapshot, analysisSettings)) return;
    const defaultAnalysis = getSnapshotAnalysis(snapshot);
    if (!defaultAnalysis) return;
    const selected = {
      ...defaultAnalysis.settings,
      dimensions: analysisSettings.dimensions,
      differenceType: analysisSettings.differenceType,
      baselineVariationIndex: analysisSettings.baselineVariationIndex,
    };
    if (getSnapshotAnalysis(snapshot, selected)) {
      setAnalysisSettings(selected);
      return;
    }
    analysisUpdate(
      selected,
      defaultAnalysis,
      snapshot,
      apiCall,
      () => undefined,
      phase,
    ).then(async (status) => {
      if (status !== "success") {
        onFailure();
        return;
      }
      await mutate({ inPlace: true });
      setAnalysisSettings(selected);
    });
  }, [
    snapshot,
    analysisSettings,
    apiCall,
    phase,
    mutate,
    setAnalysisSettings,
    onFailure,
  ]);
}
