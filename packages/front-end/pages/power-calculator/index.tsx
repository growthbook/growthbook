import { useState } from "react";
import PowerCalculationModal from "@/components/PowerCalculation/PowerCalculationModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import { PowerCalculationParams } from "@/components/PowerCalculation/types";

const PowerCalculationPage = (): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);
  const [powerCalculationParams, setPowerCalculationParams] = useState<
    PowerCalculationParams | undefined
  >();

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
      {powerCalculationParams === undefined && (
        <EmptyPowerCalculation setShowModal={setShowModal} />
      )}
    </>
  );
};

export default PowerCalculationPage;
