import { CSSProperties, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";

export default function Toggle({
  value,
  setValue,
  label = "",
  id,
  disabled = false,
  type = "toggle",
  className,
  style,
  disabledMessage,
}: {
  id: string;
  value: boolean;
  label?: string | ReactElement;
  setValue: (value: boolean) => void;
  disabled?: boolean;
  type?: "featureValue" | "environment" | "toggle";
  className?: string;
  style?: CSSProperties;
  disabledMessage?: string;
}) {
  const TooltipWrapper = ({ children }) =>
    disabledMessage ? (
      <Tooltip body={disabled && disabledMessage}>{children}</Tooltip>
    ) : (
      children
    );

  return (
    <TooltipWrapper>
      <div
        className={`toggle-switch ${
          disabled ? "disabled" : ""
        } toggle-${type} ${className || ""}`}
        style={style}
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
    </TooltipWrapper>
  );
}
