import clsx from "clsx";
import { Controller, Control } from "react-hook-form";

// eslint-disable-next-line
export type BooleanSelectControl = Control<any>;

/**
 * @deprecated
 */
export default function BooleanSelect(
  props: {
    name: string;
    control: BooleanSelectControl;
    falseLabel: string;
    trueLabel: string;
  } & React.DetailedHTMLProps<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    HTMLSelectElement
  >,
) {
  const { name, control, className, falseLabel, trueLabel, ...passThrough } =
    props;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        return (
          <select
            className={clsx(className, "form-control")}
            {...passThrough}
            value={field.value ? "true" : "false"}
            onChange={(e) => {
              field.onChange({
                ...e,
                target: {
                  ...e.target,
                  value: e.target.value === "true",
                },
              });
            }}
          >
            <option value="false">{falseLabel}</option>
            <option value="true">{trueLabel}</option>
          </select>
        );
      }}
    />
  );
}
