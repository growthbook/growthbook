import { ReactElement } from "react";
import Tooltip from "../Tooltip";

export default function Toggle({
  value,
  setValue,
  label = "",
  id,
  disabled = false,
  type = "toggle",
  className,
  disabledMessage,
}: {
  id: string;
  value: boolean;
  label?: string | ReactElement;
  setValue: (value: boolean) => void;
  disabled?: boolean;
  type?: "featureValue" | "environment" | "toggle";
  className?: string;
  disabledMessage?: string;
}) {
  return (
    <Tooltip body={disabled && disabledMessage}>
      <div
        className={`toggle-switch ${
          disabled ? "disabled" : ""
        } toggle-${type} ${className || ""}`}
      >
        <input
          type="checkbox"
          id={id}
          checked={value}
          onChange={(e) => {
            if (disabled) return;
            setValue(e.target.checked);
          }}
        />
        <label htmlFor={id}>{label || id}</label>
      </div>
    </Tooltip>
  );
}
