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
  const [revealedValue, setRevealedValue] = useState("");

  const hidden = !revealedValue;

  return (
    <div
      className={clsx("d-flex", rowReverse ? "flex-row-reverse" : "flex-row")}
    >
      <span
        role="button"
        onClick={async (e) => {
          e.preventDefault();
          if (hidden) {
            try {
              const actualValue = await getValue();
              setRevealedValue(actualValue);
            } catch (e) {
              setError(e.message);
            }
          } else {
            setRevealedValue("");
          }
        }}
      >
        {hidden ? <FaEyeSlash /> : <FaEye />}
      </span>
      <Tooltip
        className={!hidden && "w-100"}
        role="button"
        tipMinWidth="45px"
        tipPosition="top"
        body={
          hidden
            ? "Click the eye to reveal"
            : currentCopiedString === revealedValue
            ? "Copied!"
            : "Copy"
        }
        style={{ paddingLeft: "5px" }}
        onClick={(e) => {
          e.preventDefault();
          if (!hidden) {
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
          type={hidden ? "password" : "text"}
          value={hidden ? "Click to reveal hidden." : revealedValue}
          disabled={true}
          style={{
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            textOverflow: hidden ? "clip" : "ellipsis",
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
