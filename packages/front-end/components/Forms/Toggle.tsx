import { ReactElement } from "react";

export default function Toggle({
  value,
  setValue,
  label,
  id,
}: {
  id: string;
  value: boolean;
  label: string | ReactElement;
  setValue: (value: boolean) => void;
}) {
  return (
    <div className="toggle-switch">
      <input
        type="checkbox"
        id={id}
        checked={value}
        onChange={(e) => {
          setValue(e.target.checked);
        }}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
