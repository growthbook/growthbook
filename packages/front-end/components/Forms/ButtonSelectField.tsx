import clsx from "clsx";
import { ReactElement } from "react";

export interface Props<T extends string> {
  value: T;
  setValue: (value: T) => void;
  options: {
    label: string | ReactElement;
    value: T;
  }[];
  label?: string | ReactElement;
}

export default function ButtonSelectField<T extends string>({
  value,
  setValue,
  options,
  label,
}: Props<T>) {
  return (
    <div className={label ? "form-group" : ""}>
      {label && <label>{label}</label>}
      <div>
        <div className="btn-group">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx(
                "btn",
                value === option.value
                  ? "active btn-primary"
                  : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                setValue(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
