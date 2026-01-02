import clsx from "clsx";
import { ReactElement } from "react";

export interface Props<T extends string> {
  value: T;
  setValue: (value: T) => void;
  options: {
    label: string | ReactElement;
    value: T;
    disabled?: boolean;
  }[];
  label?: string | ReactElement;
  buttonType?: "inline" | "card";
  className?: string;
}

export default function ButtonSelectField<T extends string>({
  value,
  setValue,
  options,
  label,
  buttonType = "inline",
  className = "",
}: Props<T>) {
  return (
    <div
      className={clsx({
        "d-flex justify-content-center w-100": buttonType === "card",
        "form-group": label,
      })}
    >
      {label && <label>{label}</label>}
      <div>
        <div
          className={clsx(className, {
            "btn-group": buttonType === "inline",
            "btn-group-card d-flex justify-content-center align-items-stretch w-100":
              buttonType === "card",
          })}
          style={buttonType === "card" ? { gap: "1rem" } : {}}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx("btn", {
                "flex-1": buttonType === "card",
                ...(buttonType === "inline" && {
                  "active btn-primary": value === option.value,
                  "btn-outline-primary": value !== option.value,
                }),
                ...(buttonType === "card" && {
                  active: value === option.value,
                }),
                "cursor-disabled": option.disabled,
              })}
              onClick={(e) => {
                e.preventDefault();
                setValue(option.value);
              }}
              disabled={option.disabled ?? false}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
