import { useRouter } from "next/router";
import React, { ReactElement, useState } from "react";
import { includeExperimentInPayload } from "shared/util";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useAuth } from "@/services/auth";
import TabbedPage from "@/components/Experiment/TabbedPage";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SafeRolloutSnapshotProvider from "@/components/SafeRollout/SnapshotProvider";
import SafeRolloutDetails from "@/components/SafeRollout/SafeRolloutDetails";

const SafeRolloutPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { fid, srid } = router.query;

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
  }>(`/feature/${fid}`);

  // Is this needed for safe rollouts?
  //   useSwitchOrg(data?.experiment?.organization ?? null);\

  const fakeSafeRollout: SafeRolloutRule = {
    // id: "exp_2izgf19hmlp1x2efb",
    id: "fr_1l7r25wm8qnkm1l",
    description: "Fake Safe Rollout Description",
    type: "safe-rollout",
    trackingKey: "gbdemo-checkout-layout",
    datasource: "ds_2izgf19hmlp1x2cyi",
    exposureQueryId: "user_id",
    controlValue: "false",
    value: "true",
    coverage: 0.5,
    hashAttribute: "id",
    status: "running",
    guardrailMetrics: [
      "met_2izgf19hmlp1x2ef5",
      "met_2izgf19hmlp1x2eea",
      "met_2izgf19hmlp1x2eep",
      "met_2izgf19hmlp1x2eel",
      "met_2izgf19hmlp1x2een",
      "met_2izgf19hmlp1x2eeo",
    ],
    seed: "fake-seed",
    maxDurationDays: 30,
    startedAt: new Date("2023-11-17T01:03:29.927+00:00"),
    lastSnapshotAttempt: new Date("2025-03-24T17:44:09.462+00:00"),
    nextSnapshotAttempt: new Date("2025-03-24T23:44:09.462+00:00"),
  };

  if (error) {
    return <div>There was a problem loading the safe rollout</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // const canEditExperiment =
  //   permissionsUtil.canViewExperimentModal(experiment.project) &&
  //   !experiment.archived;

  // let canRunExperiment = !experiment.archived;
  // if (envs.length > 0) {
  //   if (!permissionsUtil.canRunExperiment(experiment, envs)) {
  //     canRunExperiment = false;
  //   }
  // }

  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: fid as string,
            href: `/features/${fid}`,
          },
          { display: "Safe Rollout Details" },
        ]}
      />

      <SafeRolloutSnapshotProvider
        safeRollout={fakeSafeRollout}
        feature={data?.feature}
      >
        <SafeRolloutDetails
          safeRollout={fakeSafeRollout}
          feature={data?.feature}
        />
      </SafeRolloutSnapshotProvider>
    </>
  );
};

export default SafeRolloutPage;
