import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";

import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import { Results } from "@/components/Experiment/ResultsIndicator";

const StopExperimentForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus?: ExperimentResultStatusData;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, runningExperimentStatus, close, mutate, source }) => {
  const getRecommendedResult = (
    recommendation?: ExperimentResultStatusData,
    controlVariationId?: string
  ): { result?: Results; releasedVariationId?: string } => {
    if (recommendation?.status === "ship-now") {
      return {
        result: "won",
        releasedVariationId:
          recommendation.variations.length === 1
            ? recommendation.variations[0].variationId
            : undefined,
      };
    }
    if (recommendation?.status === "rollback-now") {
      return { result: "lost", releasedVariationId: controlVariationId };
    }
    return {};
  };

  const {
    result: recommendedResult,
    releasedVariationId: recommendedReleaseVariationId,
  } = getRecommendedResult(
    runningExperimentStatus,
    experiment.variations?.[0]?.id
  );

  const recommendedReleaseVariationIndex = recommendedReleaseVariationId
    ? experiment.variations.findIndex(
        (v) => v.id === recommendedReleaseVariationId
      )
    : undefined;

  const form = useForm<{
    reason: string;
    winner: number;
    releasedVariationId: string;
    excludeFromPayload: boolean;
    analysis: string;
    results: Results;
    dateEnded: string;
  }>({
    defaultValues: {
      reason: "",
      winner: experiment.winner ?? recommendedReleaseVariationIndex ?? 0,
      releasedVariationId: experiment.variations[1].id,
      excludeFromPayload: !!experiment.excludeFromPayload,
      results: experiment.results || recommendedResult,
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });
  const { apiCall } = useAuth();

  const submit = form.handleSubmit(async (value) => {
    const winner = value.winner;
    const body = {
      ...value,
      winner,
      releasedVariationId: experiment.variations[1].id, // always force release variation to be the second variation
    };

    await apiCall(`/experiment/${experiment.id}/stop`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    track("Stop Holdout", {
      result: value.results,
    });

    mutate();
  });

  return (
    <Modal
      trackingEventModalType="stop-holdout-form"
      trackingEventModalSource={source}
      header={`Stop Holdout`}
      size="md"
      close={close}
      open={true}
      submit={submit}
      cta="Stop Holdout"
      submitColor={"danger"}
      closeCta="Cancel"
    >
      <div>
        By stopping this Holdout, Holdout users will be released and see the
        same feature values as regular users.
      </div>
    </Modal>
  );
};

export default StopExperimentForm;
