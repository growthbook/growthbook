import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FaClock, FaPencilAlt } from "react-icons/fa";
import {
  experimentHasLinkedChanges,
  includeExperimentInPayload,
} from "shared/util";
import { getVariationsForPhase } from "shared/experiments";
import { DocLink } from "@/components/DocLink";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import { useAuth } from "@/services/auth";
import Markdown from "@/components/Markdown/Markdown";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  mutate: () => void;
  editResult?: () => void;
}

export default function StoppedExperimentBanner({
  experiment,
  linkedFeatures,
  mutate,
  editResult,
}: Props) {
  const { apiCall } = useAuth();

  const hasLiveLinkedChanges = includeExperimentInPayload(
    experiment,
    linkedFeatures.map((f) => f.feature),
  );

  const isHoldout = experiment.type === "holdout";

  if (experiment.status !== "stopped") return null;

  const result = experiment.results;
  const variations = getVariationsForPhase(experiment, null);

  const winningVariation =
    (result === "lost"
      ? variations[0]?.name
      : result === "won"
        ? variations[experiment.winner || 1]?.name
        : "") || "";

  const releasedVariation =
    variations.find((v) => v.id === experiment.releasedVariationId)
      ?.name || "";

  return (
    <div className="appbox">
      <div
        className="d-flex align-items-center p-3"
        style={{ background: "var( --alert-premium-background-gradient-2)" }}
      >
        <div className="mr-2">
          <h3 className="mb-0">
            {isHoldout ? "Holdout Stopped" : "Experiment Stopped"}
          </h3>
        </div>
        {experiment.results && (
          <ResultsIndicator results={experiment.results} />
        )}
        <div className="flex-1"></div>
        {releasedVariation &&
          experimentHasLinkedChanges(experiment) &&
          hasLiveLinkedChanges &&
          !isHoldout && (
            <div className="ml-3">
              {(result === "won" || result === "lost") &&
              winningVariation !== releasedVariation ? (
                <>
                  <strong>
                    &quot;
                    {winningVariation}
                    &quot;
                  </strong>{" "}
                  won, but{" "}
                </>
              ) : null}
              <strong>
                &quot;
                {releasedVariation}
                &quot;
              </strong>{" "}
              was rolled out to 100%
            </div>
          )}
        {editResult && !isHoldout && (
          <div>
            <a
              href="#"
              className="alert-link float-right ml-2"
              onClick={(e) => {
                e.preventDefault();
                editResult();
              }}
            >
              <FaPencilAlt />
            </a>
          </div>
        )}
      </div>

      {hasLiveLinkedChanges && !isHoldout && (
        <div className="alert alert-warning m-3">
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
                <button className="btn btn-primary">
                  Stop Temporary Rollout
                </button>
              </ConfirmButton>
            </div>
          </div>
        </div>
      )}
      {experiment?.analysis && (
        <div className="border-top p-3">
          <Markdown>{experiment.analysis}</Markdown>
        </div>
      )}
    </div>
  );
}
