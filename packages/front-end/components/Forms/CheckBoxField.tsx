import clsx from "clsx";
import { forwardRef } from "react";
import Tooltip from "../Tooltip";

export type BaseCheckBoxProps = {
  id: string;
  tooltip: string;
  label: string;
  labelClassName?: string;
  containerClassName?: string;
};

export type CheckBoxFieldProps = BaseCheckBoxProps &
  React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  >;

const CheckBoxField = forwardRef(
  (
    {
      id,
      tooltip,
      label,
      labelClassName,
      containerClassName,
      ...otherProps
    }: CheckBoxFieldProps,
    // eslint-disable-next-line
        ref: any
  ) => {
    return (
      <div className={clsx("form-group", containerClassName)}>
        <input type="checkbox" ref={ref} id={id} {...otherProps} />
        {label && (
          <label htmlFor={id} className={labelClassName}>
            {label}
          </label>
        )}
        {tooltip && <Tooltip body={tooltip} tipPosition="top" />}
      </div>
    );
  }
);
CheckBoxField.displayName = "Field";

export default CheckBoxField;
