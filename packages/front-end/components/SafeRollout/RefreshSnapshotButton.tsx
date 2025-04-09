import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  safeRollout: SafeRolloutRule;
  feature: FeatureInterface;
}> = ({ mutate, safeRollout, feature }) => {
  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);

  const { apiCall } = useAuth();

  const refreshSnapshot = async () => {
    await apiCall<{
      status: number;
      message: string;
      snapshot: ExperimentSnapshotInterface;
    }>(`/safe-rollout/${safeRollout.id}/snapshot`, {
      method: "POST",
      body: JSON.stringify({
        featureId: feature.id,
      }),
    });
    mutate();
  };

  return (
    <>
      {loading && longResult && (
        <small className="text-muted mr-3">this may take several minutes</small>
      )}
      <Button
        color="outline-primary"
        onClick={async () => {
          setLoading(true);
          setLongResult(false);

          const timer = setTimeout(() => {
            setLongResult(true);
          }, 5000);

          try {
            await refreshSnapshot();
            setLoading(false);
            clearTimeout(timer);
          } catch (e) {
            setLoading(false);
            clearTimeout(timer);
            throw e;
          }
        }}
      >
        <BsArrowRepeat /> Update
      </Button>
    </>
  );
};

export default RefreshSnapshotButton;
