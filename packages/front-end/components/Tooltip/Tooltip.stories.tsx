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
            <strong>All Exposures</strong> - Multiple conversion windows, one
            for each time the user views the experiment.
          </div>
        </div>
      }
    >
      <BsThreeDotsVertical />
    </Tooltip>
  );
};
