import { useMemo, useState, useEffect } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  powerMetricWeeks,
  PowerCalculationParams,
  PowerCalculationResults,
  PartialPowerCalculationParams,
  FullModalPowerCalculationParams,
  StatsEngineSettings,
} from "shared/power";
import PowerCalculationSettingsModal, {
  PowerModalPages,
} from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import useOrgSettings from "@/hooks/useOrgSettings";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";
import track from "@/services/track";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";

const WEEKS = 9;
const INITIAL_FORM_PARAMS = { metrics: {} } as const;
const LOCAL_STORAGE_KEY = "GROWTHBOOK_POWER_CALCULATION";

type PageSettings = {
  powerCalculationParams?: FullModalPowerCalculationParams;
  settingsModalParams: PartialPowerCalculationParams;
  variations: number;
  statsEngineSettings?: StatsEngineSettings;
};

const INITIAL_PAGE_SETTINGS: PageSettings = {
  settingsModalParams: INITIAL_FORM_PARAMS,
  variations: 2,
};

const PowerCalculationPage = (): React.ReactElement => {
  const orgSettings = useOrgSettings();

  const pValueThreshold = usePValueThreshold();
  const { ciLower } = useConfidenceLevels();

  const initialJSONParams = localStorage.getItem(LOCAL_STORAGE_KEY);

  const initialParams: PageSettings = initialJSONParams
    ? JSON.parse(initialJSONParams)
    : INITIAL_PAGE_SETTINGS;

  const [showModal, setShowModal] = useState<PowerModalPages | null>(null);

  const [powerCalculationParams, setPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >(initialParams.powerCalculationParams);

  const [settingsModalParams, setSettingsModalParams] =
    useState<PartialPowerCalculationParams>(initialParams.settingsModalParams);

  const [variations, setVariations] = useState(initialParams.variations);

  const defaultStatsEngineSettings: StatsEngineSettings = {
    type: orgSettings.statsEngine || "frequentist",
    sequentialTesting: orgSettings.sequentialTestingEnabled
      ? orgSettings.sequentialTestingTuningParameter ||
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
      : false,
  };

  const [statsEngineSettings, setStatsEngineSettings] =
    useState<StatsEngineSettings>(
      initialParams.statsEngineSettings || defaultStatsEngineSettings,
    );

  const [modalStatsEngineSettings, setModalStatsEngineSettings] =
    useState<StatsEngineSettings>(statsEngineSettings);

  useEffect(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        powerCalculationParams,
        settingsModalParams,
        variations,
        statsEngineSettings,
      }),
    );
  }, [
    powerCalculationParams,
    settingsModalParams,
    variations,
    statsEngineSettings,
  ]);

  const finalParams: PowerCalculationParams | undefined = useMemo(() => {
    if (!powerCalculationParams) return;
    return {
      ...powerCalculationParams,
      statsEngineSettings,
      nVariations: variations,
      nWeeks: WEEKS,
      targetPower: 0.8,
      alpha:
        powerCalculationParams.alpha ||
        (statsEngineSettings.type === "frequentist"
          ? pValueThreshold
          : ciLower),
    };
  }, [
    powerCalculationParams,
    variations,
    statsEngineSettings,
    pValueThreshold,
    ciLower,
  ]);

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!finalParams) return;
    return powerMetricWeeks(finalParams);
  }, [finalParams]);
  return (
    <div className="contents power-calculator container-fluid pagecontents">
      {showModal && (
        <PowerCalculationSettingsModal
          close={() => setShowModal(null)}
          onSuccess={(p) => {
            track("power-calculation-settings-update", {
              type: "success",
              source: p.metricValuesData.source,
              numMetrics: p.metrics.length,
              metricsMetaData: Object.keys(p.metrics).map((m: string) => {
                const metric = p.metrics[m];
                return {
                  type: metric.type,
                  effectSize: metric.effectSize,
                };
              }),
            });
            setSettingsModalParams(p);
            setPowerCalculationParams(p);
            setStatsEngineSettings(modalStatsEngineSettings);
            setShowModal(null);
          }}
          statsEngineSettings={modalStatsEngineSettings}
          params={settingsModalParams}
          startPage={showModal}
        />
      )}
      {finalParams === undefined && (
        <EmptyPowerCalculation showModal={() => setShowModal("select")} />
      )}
      {results && finalParams && powerCalculationParams ? (
        <PowerCalculationContent
          params={finalParams}
          results={results}
          edit={() => {
            setSettingsModalParams(powerCalculationParams);
            setModalStatsEngineSettings(statsEngineSettings);
            setShowModal("set-params");
          }}
          updateVariations={setVariations}
          updateStatsEngineSettingsWithAlpha={(v) => {
            setPowerCalculationParams({
              ...powerCalculationParams,
              alpha: v.alpha,
            });
            setStatsEngineSettings(v);
          }}
          newCalculation={() => {
            setModalStatsEngineSettings(defaultStatsEngineSettings);
            setSettingsModalParams(INITIAL_FORM_PARAMS);
            setShowModal("select");
          }}
        />
      ) : null}
    </div>
  );
};

export default PowerCalculationPage;
