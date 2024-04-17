import { useMemo, useState } from "react";
import PowerCalculationModal from "@/components/PowerCalculation/PowerCalculationModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";
import {
  PowerCalculationParams,
  PowerCalculationResults,
  FullModalPowerCalculationParams,
} from "@/components/PowerCalculation/types";

const dummyResultsData = (metrics: PowerCalculationParams["metrics"]) => ({
  sampleSizeAndRuntime: Object.keys(metrics).reduce(
    (sampleSizeAndRuntime, id) => ({
      ...sampleSizeAndRuntime,
      [id]: {
        type: metrics[id].type,
        name: metrics[id].name,
        effectSize: 0.3234,
        days: 10,
        users: 12245,
      },
    }),
    {}
  ),
  weeks: [...Array(7).keys()].map(() => ({
    users: 12245,
    metrics: Object.keys(metrics).reduce(
      (ret, id) => ({
        ...ret,
        [id]: {
          type: metrics[id].type,
          name: metrics[id].name,
          effectSize: 0.3234,
          power: 0.8,
        },
      }),
      {}
    ),
  })),
});

const PowerCalculationPage = (): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);
  const [powerCalculationParams, setPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >();
  const [variations, setVariations] = useState(2);

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!powerCalculationParams) return;

    return {
      duration: 3,
      power: 0.8,
      ...dummyResultsData(powerCalculationParams.metrics),
    };
  }, [powerCalculationParams]);

  const finalParams: PowerCalculationParams | undefined = useMemo(() => {
    if (!powerCalculationParams) return;

    return {
      ...powerCalculationParams,
      nVariations: variations,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: false,
      },
    };
  }, [powerCalculationParams, variations]);

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
