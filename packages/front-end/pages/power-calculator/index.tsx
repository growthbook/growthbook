import { useMemo, useState } from "react";
import PowerCalculationModal from "@/components/PowerCalculation/PowerCalculationModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";

import {
  PowerCalculationParams,
  PowerCalculationResults,
  FullModalPowerCalculationParams,
} from "@/components/PowerCalculation/types";

import { powerMetricWeeks } from "@/components/PowerCalculation/stats";

const WEEKS = 9;

const PowerCalculationPage = (): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);
  const [powerCalculationParams, setPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >();
  const [variations, setVariations] = useState(2);

  const finalParams: PowerCalculationParams | undefined = useMemo(() => {
    if (!powerCalculationParams) return;

    return {
      ...powerCalculationParams,
      nVariations: variations,
      nWeeks: WEEKS,
      targetPower: 0.8,
      alpha: 0.05,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: false,
      },
    };
  }, [powerCalculationParams, variations]);

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!finalParams) return;

    return powerMetricWeeks(finalParams);
  }, [finalParams]);

  return (
    <>
      {showModal && (
        <PowerCalculationModal
          close={() => setShowModal(false)}
          onSuccess={(p) => {
            setPowerCalculationParams(p);
            setShowModal(false);
          }}
        />
      )}
      {finalParams === undefined && (
        <EmptyPowerCalculation showModal={() => setShowModal(true)} />
      )}
      {results && finalParams && (
        <PowerCalculationContent
          params={finalParams}
          results={results}
          clear={() => setPowerCalculationParams(undefined)}
          updateVariations={setVariations}
          showModal={() => {
            setPowerCalculationParams(undefined);
            setShowModal(true);
          }}
        />
      )}
    </>
  );
};

export default PowerCalculationPage;
