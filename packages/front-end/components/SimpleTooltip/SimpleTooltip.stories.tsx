import { SimpleTooltip } from "./SimpleTooltip";
import React from "react";
import { select, text } from "@storybook/addon-knobs";
import { FaCopy } from "react-icons/all";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

export default {
  component: SimpleTooltip,
  title: "Feedback/SimpleTooltip",
};

export const LotsOfText = () => {
  return (
    <div style={{ position: "relative", margin: 100 }}>
      <p>
        Leverage agile frameworks to provide a robust synopsis for high level
        overviews. Iterative approaches to corporate strategy foster
        collaborative thinking to further the overall value proposition.
        Organically grow the holistic world view of disruptive innovation via
        workplace diversity and empowerment.
      </p>
      <p>
        Bring to the table win-win survival strategies to ensure proactive
        domination. At the end of the day, going forward, a new normal that has
        evolved from generation X is on the runway heading towards a streamlined
        cloud solution. User generated content in real-time will have multiple
        touchpoints for offshoring.
      </p>
      <p>
        Capitalize on low hanging fruit to identify a ballpark value added
        activity to beta test. Override the digital divide with additional
        clickthroughs from DevOps. Nanotechnology immersion along the
        information highway will close the loop on focusing solely on the bottom
        line.
      </p>

      <SimpleTooltip
        position={select(
          "Position",
          ["top", "bottom", "left", "right"],
          "bottom"
        )}
      >
        {text("Tooltip text (1)", "Copied!")}
      </SimpleTooltip>
    </div>
  );
};

export const ButtonFeedback = () => {
  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: -1,
  });

  return (
    <div className="d-flex" style={{ margin: 100 }}>
      <div
        className="d-flex align-items-center"
        style={{ position: "relative" }}
      >
        <button className="btn" onClick={() => performCopy("token_abc123")}>
          <FaCopy />
        </button>

        <span>token_abc123</span>

        {copySuccess && (
          <SimpleTooltip
            position={select(
              "Position",
              ["top", "bottom", "left", "right"],
              "bottom"
            )}
          >
            {text(
              "Tooltip text (2)",
              "The token has been copied to your clipboard"
            )}
          </SimpleTooltip>
        )}
      </div>
    </div>
  );
};
