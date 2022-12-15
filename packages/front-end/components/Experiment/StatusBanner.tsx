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

  if (experiment.status === "stopped") {
    const result = experiment.results;
    const variationsPlural =
      experiment.variations.length > 2 ? "variations" : "variation";
    return (
      <div
        className={clsx("alert mb-0", {
          "alert-success": result === "won",
          "alert-danger": result === "lost",
          "alert-info": !result || result === "inconclusive",
          "alert-warning": result === "dnf",
        })}
      >
        {editResult && (
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
        )}
        <strong>
          {result === "won" &&
            `${
              experiment.winner > 0
                ? experiment.variations[experiment.winner]?.name
                : "A variation"
            } beat the control and won!`}
          {result === "lost" &&
            `The ${variationsPlural} did not beat the control.`}
          {result === "dnf" &&
            `The experiment was stopped early and did not finish.`}
          {result === "inconclusive" && `The results were inconclusive.`}
          {!result &&
            `The experiment was stopped, but a winner has not been selected yet.`}
        </strong>
        {experiment.analysis && (
          <div className="card text-dark mt-2">
            <div className="card-body">
              <Markdown className="card-text">{experiment.analysis}</Markdown>
            </div>
          </div>
        )}
      </div>
    );
  }

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
            Mark as Finished
          </a>
        )}
        <strong>This experiment is currently running.</strong>
      </div>
    );
  }

  if (experiment.status === "draft") {
    return (
      <div className={clsx("alert mb-0 alert-warning")}>
        {editResult && (
          <Button
            color="link"
            className="alert-link float-right ml-2 p-0"
            onClick={async () => {
              // Already has a phase, just update the status
              await apiCall(`/experiment/${experiment.id}/status`, {
                method: "POST",
                body: JSON.stringify({
                  status: "running",
                }),
              });
              mutateExperiment();
            }}
          >
            Mark as Running
          </Button>
        )}
        <strong>This is a draft experiment.</strong>
      </div>
    );
  }
}
