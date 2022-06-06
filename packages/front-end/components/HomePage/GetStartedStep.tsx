import clsx from "clsx";
import { ReactElement } from "react";
import { FaCheck } from "react-icons/fa";
import { FiArrowRight } from "react-icons/fi";

export type Props = {
  current: boolean;
  finished: boolean;
  image: string;
  title: string;
  text: string | ReactElement;
  hideCTA?: boolean;
  onClick: (finished: boolean) => void;
  cta: string;
  finishedCTA: string;
  className?: string;
  imageLeft: boolean;
  permissionsError?: boolean;
};

export default function GetStartedStep({
  current,
  finished,
  image,
  title,
  text,
  hideCTA = false,
  onClick,
  cta,
  finishedCTA,
  imageLeft,
  className = "",
  permissionsError = false,
}: Props) {
  const imgEl = (
    <div className="col-4 d-none d-sm-block">
      <img
        className=""
        style={{ width: "100%", maxWidth: "200px", maxHeight: "160px" }}
        src={image}
        alt=""
      />
    </div>
  );

  return (
    <div
      className={clsx("card-body extra-padding", className, {
        "active-step": current,
        "step-done": finished,
      })}
    >
      <div className="row">
        {imageLeft && imgEl}
        <div className="col-12 col-sm-8">
          <div className="card-title">
            <h3 className="">
              {title}
              <span className="h3 mb-0 ml-3 complete checkmark d-none">
                <FaCheck /> Completed
              </span>
            </h3>
          </div>
          <div className="card-text mb-3">{text}</div>
          {permissionsError && (
            <div className="alert alert-info">
              <strong>Notice:</strong> You don&apos;t have the required
              permissions to complete this step.
            </div>
          )}
          <a
            className={clsx(`action-link mr-3`, {
              "btn btn-outline-primary": finished,
              "btn btn-primary": !finished && current,
              "non-active-step": !finished && !current,
              "d-none": permissionsError || (!finished && hideCTA),
            })}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (permissionsError) return;
              if (finished) {
                onClick(true);
              } else if (!hideCTA) {
                onClick(false);
              }
            }}
          >
            {finished ? finishedCTA : cta} <FiArrowRight />
          </a>
        </div>
        {!imageLeft && imgEl}
      </div>
    </div>
  );
}
