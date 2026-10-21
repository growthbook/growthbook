import { useRouter } from "next/router";
import React, { ReactElement } from "react";
import { useContextualBandit } from "@/hooks/useContextualBandits";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import ExperimentPage from "@/pages/experiment/[eid]";

const ContextualBanditMeasurementArmPage = (): ReactElement => {
  const router = useRouter();
  const { cbid } = router.query;
  const rawId = typeof cbid === "string" ? cbid : "";
  const { contextualBandit: cb, loading } = useContextualBandit(
    rawId || undefined,
  );

  if (loading) {
    return <LoadingOverlay />;
  }
  if (!cb) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="error" mt="4">
          Contextual Bandit not found.
        </Callout>
      </div>
    );
  }
  if (!cb.measurementArm?.enabled || !cb.measurementArm.experimentId) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="info" mt="4">
          This Contextual Bandit does not have a measurement arm.
        </Callout>
      </div>
    );
  }

  return (
    <ExperimentPage
      experimentId={cb.measurementArm.experimentId}
      breadcrumb={[
        { display: "Contextual Bandits", href: `/contextual-bandits` },
        { display: cb.name, href: `/contextual-bandit/${cb.id}` },
        { display: "Measurement Arm" },
      ]}
    />
  );
};

export default ContextualBanditMeasurementArmPage;
