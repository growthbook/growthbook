import { useMemo, useState, useEffect } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import PowerCalculationSettingsModal from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import useOrgSettings from "@/hooks/useOrgSettings";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";

import {
  PowerCalculationParams,
  PowerCalculationResults,
  PartialPowerCalculationParams,
  FullModalPowerCalculationParams,
  StatsEngineSettings,
} from "@/components/PowerCalculation/types";

import { powerMetricWeeks } from "@/components/PowerCalculation/stats";
import track from "@/services/track";

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

  const initialJSONParams = localStorage.getItem(LOCAL_STORAGE_KEY);

  const initialParams: PageSettings = initialJSONParams
    ? JSON.parse(initialJSONParams)
    : INITIAL_PAGE_SETTINGS;

  const [showModal, setShowModal] = useState(false);

  const [powerCalculationParams, setPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >(initialParams.powerCalculationParams);

  const [
    settingsModalParams,
    setSettingsModalParams,
  ] = useState<PartialPowerCalculationParams>(
    initialParams.settingsModalParams
  );

  const [variations, setVariations] = useState(initialParams.variations);

  const defaultStatsEngineSettings: StatsEngineSettings = {
    type: orgSettings.statsEngine || "frequentist",
    sequentialTesting: orgSettings.sequentialTestingEnabled
      ? orgSettings.sequentialTestingTuningParameter ||
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
      : false,
  };

  const [
    statsEngineSettings,
    setStatsEngineSettings,
  ] = useState<StatsEngineSettings>(
    initialParams.statsEngineSettings || defaultStatsEngineSettings
  );

  const [
    modalStatsEngineSettings,
    setModalStatsEngineSettings,
  ] = useState<StatsEngineSettings>(statsEngineSettings);

  useEffect(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        powerCalculationParams,
        settingsModalParams,
        variations,
        statsEngineSettings,
      })
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
      alpha: 0.05,
    };
  }, [powerCalculationParams, variations, statsEngineSettings]);

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!finalParams) return;
    return powerMetricWeeks(finalParams);
  }, [finalParams]);
  return (
    <div className="contents power-calculator container-fluid pagecontents">
      {showModal && (
        <PowerCalculationSettingsModal
          close={() => setShowModal(false)}
          onSuccess={(p) => {
            track("power-calculation-settings-update", {
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
            setShowModal(false);
          }}
          statsEngineSettings={modalStatsEngineSettings}
          params={settingsModalParams}
        />
      )}
      {finalParams === undefined && (
        <EmptyPowerCalculation showModal={() => setShowModal(true)} />
      )}
      {results && finalParams && powerCalculationParams && (
        <PowerCalculationContent
          params={finalParams}
          results={results}
          edit={() => {
            setSettingsModalParams(powerCalculationParams);
            setModalStatsEngineSettings(statsEngineSettings);
            setShowModal(true);
          }}
          updateVariations={setVariations}
          updateStatsEngineSettings={setStatsEngineSettings}
          newCalculation={() => {
            setModalStatsEngineSettings(defaultStatsEngineSettings);
            setSettingsModalParams(INITIAL_FORM_PARAMS);
            setShowModal(true);
          }}
        />
      )}
    </div>
  );
};

export default PowerCalculationPage;
