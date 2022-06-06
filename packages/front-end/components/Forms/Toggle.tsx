import { ReactElement } from "react";

export default function Toggle({
  value,
  setValue,
  label = "",
  id,
  disabled = false,
}: {
  id: string;
  value: boolean;
  label?: string | ReactElement;
  setValue: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`toggle-switch ${disabled ? "disabled" : ""}`}>
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
