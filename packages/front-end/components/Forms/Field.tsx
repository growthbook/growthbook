import clsx from "clsx";
import {
  ReactElement,
  ReactNode,
  useState,
  forwardRef,
  DetailedHTMLProps,
  SelectHTMLAttributes,
} from "react";
import TextareaAutosize, {
  TextareaAutosizeProps,
} from "react-textarea-autosize";

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
  markRequired?: boolean;
  error?: ReactNode;
  helpText?: ReactNode;
  helpTextClassName?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  inputGroupClassName?: string;
  labelClassName?: string;
  // eslint-disable-next-line
  render?: (id: string, ref: any) => ReactElement;
  options?: SelectOptions;
  optionGroups?: { [key: string]: SelectOptions };
  initialOption?: string;
  minRows?: number;
  maxRows?: number;
  textarea?: boolean;
  prepend?: ReactElement | string;
  append?: ReactElement | string;
  comboBox?: boolean;
  currentLength?: number;
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
      helpTextClassName,
      containerClassName,
      containerStyle,
      inputGroupClassName,
      labelClassName,
      label,
      markRequired,
      prepend,
      append,
      render,
      textarea,
      minRows,
      maxRows,
      options,
      optionGroups,
      type = "text",
      initialOption,
      comboBox,
      ...otherProps
    }: FieldProps,
    // eslint-disable-next-line
    ref: any,
  ) => {
    const [fieldId] = useState(
      () => id || `field_${Math.floor(Math.random() * 1000000)}`,
    );

    const cn = clsx("form-control", className);

    let component: ReactElement;
    if (render) {
      component = render(fieldId, ref);
    } else if (textarea) {
      component = (
        <TextareaAutosize
          {...(otherProps as unknown as TextareaAutosizeProps)}
          ref={ref}
          id={fieldId}
          className={cn}
          minRows={minRows || 2}
          maxRows={maxRows || 6}
        />
      );
    } else if (comboBox && options) {
      const listId = `${fieldId}_datalist`;
      component = (
        <>
          <input
            {...otherProps}
            ref={ref}
            id={fieldId}
            type={type}
            className={cn}
            list={listId}
            autoComplete="off"
          />
          <datalist id={listId}>
            {options && <Options options={options} />}
          </datalist>
        </>
      );
    } else if (options || optionGroups) {
      component = (
        <select
          {...(otherProps as unknown as DetailedHTMLProps<
            SelectHTMLAttributes<HTMLSelectElement>,
            HTMLSelectElement
          >)}
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
        <div className={clsx("input-group", inputGroupClassName)}>
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

    const customClassName = otherProps?.["customClassName"] || "";
    return (
      <div
        className={clsx(
          "form-group",
          containerClassName,
          { "mb-0": !label },
          render ? customClassName : "",
        )}
        style={containerStyle}
      >
        <div className="d-flex flex-row justify-content-between">
          {label && (
            <label htmlFor={fieldId} className={clsx(labelClassName)}>
              {label}
              {markRequired && <span className="text-danger ml-1">*</span>}
            </label>
          )}
          {otherProps.currentLength !== undefined && otherProps.maxLength ? (
            <div className="font-weight-light">
              <small>{`${otherProps.currentLength} / ${otherProps.maxLength}`}</small>
            </div>
          ) : null}
        </div>
        {component}
        {error && <div className="form-text text-danger">{error}</div>}
        {helpText && (
          <small className={clsx("form-text text-muted", helpTextClassName)}>
            {helpText}
          </small>
        )}
      </div>
    );
  },
);
Field.displayName = "Field";

export default Field;
