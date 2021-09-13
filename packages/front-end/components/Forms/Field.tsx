import clsx from "clsx";
import { ReactElement, ReactNode, useState, forwardRef } from "react";
import TextareaAutosize from "react-textarea-autosize";

export type SelectOptions =
  | (
      | string
      | number
      | null
      | {
          value: string | number;
          display: string;
        }
    )[]
  | Record<string, string>;

export type BaseFieldProps = {
  label?: ReactNode;
  error?: ReactNode;
  helpText?: ReactNode;
  containerClassName?: string;
  labelClassName?: string;
  // eslint-disable-next-line
  render?: (id: string, ref: any) => ReactElement;
  options?: SelectOptions;
  initialOption?: string;
  minRows?: number;
  maxRows?: number;
  textarea?: boolean;
  prepend?: string;
  append?: string;
};

export type FieldProps = BaseFieldProps &
  React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  >;

const Field = forwardRef(
  (
    {
      id,
      className,
      error,
      helpText,
      containerClassName,
      labelClassName,
      label,
      prepend,
      append,
      render,
      textarea,
      minRows,
      maxRows,
      options,
      type = "text",
      initialOption,
      ...otherProps
    }: FieldProps,
    // eslint-disable-next-line
    ref: any
  ) => {
    const [fieldId] = useState(
      () => id || `field_${Math.floor(Math.random() * 1000000)}`
    );

    const cn = clsx("form-control", className);

    let component: ReactElement;
    if (render) {
      component = render(fieldId, ref);
    } else if (textarea) {
      component = (
        <TextareaAutosize
          {...(otherProps as unknown)}
          ref={ref}
          id={fieldId}
          className={cn}
          minRows={minRows || 2}
          maxRows={maxRows || 6}
        />
      );
    } else if (options) {
      component = (
        <select
          {...(otherProps as unknown)}
          ref={ref}
          id={fieldId}
          className={cn}
        >
          {initialOption && <option value="">{initialOption}</option>}
          {Array.isArray(options)
            ? options.map((o) => {
                if (o === null || o === undefined) return null;
                if (typeof o === "object") {
                  return (
                    <option key={o.value} value={o.value}>
                      {o.display}
                    </option>
                  );
                } else {
                  return (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  );
                }
              })
            : Object.keys(options).map((k) => {
                return (
                  <option key={k} value={k}>
                    {options[k]}
                  </option>
                );
              })}
        </select>
      );
    } else {
      component = (
        <input
          {...otherProps}
          ref={ref}
          id={fieldId}
          type={type}
          className={cn}
        />
      );
    }

    if (prepend || append) {
      component = (
        <div className="input-group">
          {prepend && (
            <div className="input-group-prepend">
              <div className="input-group-text">{prepend}</div>
            </div>
          )}
          {component}
          {append && (
            <div className="input-group-append">
              <div className="input-group-text">{append}</div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={clsx("form-group", containerClassName)}>
        {label && (
          <label htmlFor={fieldId} className={clsx(labelClassName)}>
            {label}
          </label>
        )}
        {component}
        {error && <div className="form-text text-danger">{error}</div>}
        {helpText && <small className="form-text text-muted">{helpText}</small>}
      </div>
    );
  }
);
Field.displayName = "Field";

export default Field;
