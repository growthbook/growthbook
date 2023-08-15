import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaClock } from "react-icons/fa";
import { includeExperimentInPayload } from "shared/util";
import { DocLink } from "@/components/DocLink";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import { useAuth } from "@/services/auth";
import { LinkedFeature } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  linkedFeatures: LinkedFeature[];
}

export default function TemporaryRolloutBanner({
  experiment,
  mutate,
  linkedFeatures,
}: Props) {
  const { apiCall } = useAuth();

  const hasLiveLinkedChanges = includeExperimentInPayload(
    experiment,
    linkedFeatures.map((f) => f.feature)
  );

  if (experiment.status !== "stopped" || !hasLiveLinkedChanges) return null;

  return (
    <div className="alert alert-warning mb-3">
      <div className="d-flex align-items-center">
        <div>
          <FaClock /> <strong>Temporary Rollout Enabled</strong>
          <div className="my-1">
            This experiment has been stopped, but changes are still being
            applied to give you time to implement them in code.
          </div>
          When you no longer need this rollout, stop it to improve your site
          performance.{" "}
          <DocLink docSection="temporaryRollout">Learn more</DocLink>
        </div>
        <div className="ml-auto pl-2">
          <ConfirmButton
            onClick={async () => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({
                  excludeFromPayload: true,
                }),
              });
              mutate();
            }}
            modalHeader="Stop Temporary Rollout"
            confirmationText={
              <>
                <p>Are you sure you want to stop the Temporary Rollout?</p>
                <p>
                  This will completely stop serving traffic to the winning
                  variation.
                </p>
              </>
            }
            cta="Stop Rollout"
          >
            <button className="btn btn-primary">Stop Temporary Rollout</button>
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}
