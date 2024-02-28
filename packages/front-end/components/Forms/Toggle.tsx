import { CSSProperties, ReactElement } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function Toggle({
  value,
  setValue,
  label = "",
  id,
  disabled = false,
  type = "toggle",
  className,
  style,
  innerStyle,
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
  innerStyle?: CSSProperties;
  disabledMessage?: string;
}) {
  const TooltipWrapper = ({ children }) =>
    disabledMessage ? (
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | false' is not assignable to type 's... Remove this comment to see the full error message
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
        <label style={innerStyle} htmlFor={id}>
          {label || id}
        </label>
      </div>
    </TooltipWrapper>
  );
}
