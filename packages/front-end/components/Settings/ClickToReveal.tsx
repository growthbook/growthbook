import clsx from "clsx";
import { useState } from "react";
import { FaExclamationTriangle, FaEye, FaEyeSlash } from "react-icons/fa";
import Tooltip from "../Tooltip/Tooltip";
import ClickToCopy from "./ClickToCopy";

export type SecretKey = {
  [key: string]: string;
};
export interface Props {
  rowReverse?: boolean;
  getValue: () => Promise<string>;
}

export default function ClickToReveal({ rowReverse, getValue }: Props) {
  const [error, setError] = useState("");
  const [revealedValue, setRevealedValue] = useState<null | string>(null);
  const [showRevealedValue, setShowRevaledValue] = useState(false);

  return (
    <div
      className={clsx("d-flex", rowReverse ? "flex-row-reverse" : "flex-row")}
    >
      <span
        role="button"
        onClick={async (e) => {
          e.preventDefault();
          if (!revealedValue) {
            try {
              setRevealedValue(await getValue());
              setShowRevaledValue(true);
            } catch (e) {
              setError(e.message);
            }
          } else {
            setShowRevaledValue(!showRevealedValue);
          }
        }}
      >
        {!showRevealedValue ? <FaEyeSlash /> : <FaEye />}
      </span>
      <ClickToCopy valueToCopy={revealedValue}>
        <input
          role="button"
          type={!showRevealedValue ? "password" : "text"}
          value={!showRevealedValue ? "Click to reveal hidden." : revealedValue}
          disabled={true}
          style={{
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            textOverflow: !showRevealedValue ? "clip" : "ellipsis",
            textAlign: rowReverse ? "right" : "left",
            paddingRight: rowReverse ? "5px" : "0px",
            width: "100%",
          }}
        />
      </ClickToCopy>
      {error && (
        <Tooltip body={error}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      )}
    </div>
  );
}
