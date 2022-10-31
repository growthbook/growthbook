import clsx from "clsx";
import { useState } from "react";
import { FaExclamationTriangle, FaEye, FaEyeSlash } from "react-icons/fa";
import Tooltip from "../Tooltip";

export type SecretKey = {
  [key: string]: string;
};
export interface Props {
  rowReverse?: boolean;
  currentCopiedString: string;
  setCurrentCopiedString: (value: string) => void;
  getValue: () => Promise<string>;
}

export default function ClickToReveal({
  rowReverse,
  currentCopiedString,
  setCurrentCopiedString,
  getValue,
}: Props) {
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
      <Tooltip
        className={showRevealedValue && "w-100"}
        role="button"
        tipMinWidth="45px"
        tipPosition="top"
        body={
          !showRevealedValue
            ? "Click the eye to reveal"
            : currentCopiedString === revealedValue
            ? "Copied!"
            : "Copy"
        }
        style={{ paddingLeft: "5px" }}
        onClick={(e) => {
          e.preventDefault();
          if (showRevealedValue) {
            navigator.clipboard
              .writeText(revealedValue)
              .then(() => {
                setCurrentCopiedString(revealedValue);
              })
              .catch((e) => {
                setError(e.message);
                console.error(e);
              });
          }
        }}
      >
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
      </Tooltip>
      {error && (
        <Tooltip body={error}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      )}
    </div>
  );
}
