import { ReactElement } from "react";

export default function Toggle({
  value,
  setValue,
  label = "",
  id,
  disabled = false,
  type = "toggle",
  className,
}: {
  id: string;
  value: boolean;
  label?: string | ReactElement;
  setValue: (value: boolean) => void;
  disabled?: boolean;
  type?: "featureValue" | "environment" | "toggle";
  className?: string;
}) {
  return (
    <div
      className={`toggle-switch ${disabled ? "disabled" : ""} toggle-${type} ${
        className || ""
      }`}
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
  );
}
