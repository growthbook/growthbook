import React from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import Tooltip from "./Tooltip";

export default {
  title: "Tooltip",
  component: Tooltip,
};

export const Default = () => {
  return (
    <div>
      <Tooltip body="This is a tooltip" />
    </div>
  );
};

export const WithIconAndHtml = () => {
  return (
    <Tooltip
      className="ml-5"
      body={
        <div>
          <div className="mb-2">
            Determines how we attribute metric conversions to this experiment.
          </div>
          <div className="mb-2">
            <strong>First Exposure</strong> - Single conversion window based on
            the first time the user views the experiment.
          </div>
          <div>
            <strong>Experiment Duration</strong> - Single conversion window,
            from the first time a user views the experiment until the end of the
            experiment.
          </div>
        </div>
      }
    >
      <BsThreeDotsVertical />
    </Tooltip>
  );
};
