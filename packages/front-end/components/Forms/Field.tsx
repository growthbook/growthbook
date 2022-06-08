import clsx from "clsx";
import { ReactElement, ReactNode, useState, forwardRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import dynamic from "next/dynamic";
const SqlTextArea = dynamic(() => import("../Forms/SqlTextArea"), {
  ssr: false,
});

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
  optionGroups?: { [key: string]: SelectOptions };
  initialOption?: string;
  minRows?: number;
  maxRows?: number;
  textarea?: boolean;
  sqlTextarea?: boolean;
  sqlTextareaHeight?: string;
  existingValue?: string;
  setValue?: (value: string) => void;
  prepend?: string;
  append?: string;
};

export type FieldProps = BaseFieldProps &
  React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  >;

function Options({ options }: { options: SelectOptions }) {
  if (Array.isArray(options)) {
    return (
      <>
        {options.map((o) => {
          if (o === null || o === undefined) return null;
          if (typeof o === "object") {
            return (
              <option key={o.value + ""} value={o.value + ""}>
                {o.display}
              </option>
            );
          } else {
            return (
              <option key={o + ""} value={o + ""}>
                {o}
              </option>
            );
          }
        })}
      </>
    );
  }

  return (
    <>
      {Object.keys(options).map((k) => {
        return (
          <option key={k} value={k}>
            {options[k]}
          </option>
        );
      })}
    </>
  );
}

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
      placeholder,
      append,
      render,
      textarea,
      sqlTextarea,
      sqlTextareaHeight,
      existingValue,
      setValue,
      minRows,
      maxRows,
      options,
      optionGroups,
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
    } else if (sqlTextarea) {
      component = (
        <SqlTextArea
          placeholder={placeholder}
          setValue={setValue}
          existingValue={existingValue}
          height={sqlTextareaHeight}
        />
      );
    } else if (options || optionGroups) {
      component = (
        <select
          {...(otherProps as unknown)}
          ref={ref}
          id={fieldId}
          className={cn}
        >
          {initialOption && <option value="">{initialOption}</option>}
          {options && <Options options={options} />}
          {optionGroups &&
            Object.keys(optionGroups).map((k) => {
              return (
                <optgroup label={k} key={k}>
                  <Options options={optionGroups[k]} />
                </optgroup>
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
      <div
        className={clsx("form-group", containerClassName, {
          "mb-0": !label,
        })}
      >
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
