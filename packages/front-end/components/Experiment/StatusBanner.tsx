import clsx from "clsx";
import { FaPencilAlt } from "react-icons/fa";
import { getVariationsForPhase } from "shared/experiments";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";
import Markdown from "@/components/Markdown/Markdown";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment: () => void;
  editResult?: () => void;
}

export default function StatusBanner({ mutateExperiment, editResult }: Props) {
  const { experiment } = useSnapshot();
  const { apiCall } = useAuth();

  if (experiment?.status === "stopped") {
    const result = experiment.results;
    const variations = getVariationsForPhase(experiment, null);

    const winningVariation =
      (result === "lost"
        ? variations[0]?.name
        : result === "won"
          ? variations[experiment.winner || 1]?.name
          : "") || "";

    const releasedVariation =
      variations.find((v) => v.id === experiment.releasedVariationId)?.name ||
      "";

    return (
      <div
        className={clsx("alert mb-0", {
          "alert-success": result === "won",
          "alert-danger": result === "lost",
          "alert-info": !result || result === "inconclusive",
          "alert-warning": result === "dnf",
        })}
      >
        <div className="d-flex">
          <div className="mr-auto">
            <strong>
              {result === "won" && `The experiment won!`}
              {result === "lost" && `The experiment lost!`}
              {result === "dnf" &&
                `The experiment was stopped early and did not finish.`}
              {result === "inconclusive" && `The results were inconclusive.`}
              {!result &&
                `The experiment was stopped, but a final decision has not been made yet.`}
            </strong>
          </div>
          {releasedVariation && (
            <div className="px-3">
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
          {editResult && (
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
        {experiment?.analysis && (
          <div className="card text-dark mt-2">
            <div className="card-body">
              <Markdown className="card-text">{experiment.analysis}</Markdown>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (experiment?.status === "running") {
    return (
      <div className={clsx("alert mb-0 alert-info")}>
        {editResult && (
          <a
            href="#"
            className="alert-link float-right ml-2"
            onClick={(e) => {
              e.preventDefault();
              editResult();
            }}
          >
            Stop{" "}
            {experiment.type === "multi-armed-bandit" ? "Bandit" : "Experiment"}
          </a>
        )}
        <strong>This experiment is currently running.</strong>
      </div>
    );
  }

  if (experiment?.status === "draft") {
    return (
      <div className={clsx("alert mb-0 alert-warning")}>
        {editResult && (
          <Button
            color="link"
            className="alert-link float-right ml-2 p-0"
            onClick={async () => {
              // Already has a phase, just update the status
              await apiCall(`/experiment/${experiment?.id}/status`, {
                method: "POST",
                body: JSON.stringify({
                  status: "running",
                }),
              });
              mutateExperiment();
            }}
          >
            Start Experiment
          </Button>
        )}
        <strong>This is a draft experiment.</strong>
      </div>
    );
  }

  return null;
}
