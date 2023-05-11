import clsx from "clsx";
import { FaPencilAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Button from "../Button";
import Markdown from "../Markdown/Markdown";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment: () => void;
  editResult: () => void;
}

export default function StatusBanner({ mutateExperiment, editResult }: Props) {
  const { experiment } = useSnapshot();
  const { apiCall } = useAuth();

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  if (experiment.status === "stopped") {
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    const result = experiment.results;

    const winningVariation =
      (result === "lost"
        ? // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          experiment.variations[0]?.name
        : result === "won"
        ? // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          experiment.variations[experiment.winner || 1]?.name
        : "") || "";

    const releasedVariation =
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      experiment.variations.find((v) => v.id === experiment.releasedVariationId)
        ?.name || "";

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
              {winningVariation !== releasedVariation && (
                <>
                  <strong>
                    &quot;
                    {winningVariation}
                    &quot;
                  </strong>{" "}
                  won, but{" "}
                </>
              )}
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
        {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
        {experiment.analysis && (
          <div className="card text-dark mt-2">
            <div className="card-body">
              {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
              <Markdown className="card-text">{experiment.analysis}</Markdown>
            </div>
          </div>
        )}
      </div>
    );
  }

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  if (experiment.status === "running") {
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
            Stop Experiment
          </a>
        )}
        <strong>This experiment is currently running.</strong>
      </div>
    );
  }

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  if (experiment.status === "draft") {
    return (
      <div className={clsx("alert mb-0 alert-warning")}>
        {/* @ts-expect-error TS(2774) If you come across this, please fix it!: This condition will always return true since this ... Remove this comment to see the full error message */}
        {editResult && (
          <Button
            color="link"
            className="alert-link float-right ml-2 p-0"
            onClick={async () => {
              // Already has a phase, just update the status
              // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
              await apiCall(`/experiment/${experiment.id}/status`, {
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
}
