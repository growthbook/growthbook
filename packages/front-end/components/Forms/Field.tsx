import clsx from "clsx";
import { ReactElement, ReactNode, useState, forwardRef } from "react";
import TextareaAutosize, {
  TextareaAutosizeProps,
} from "react-textarea-autosize";
import HelperText from "@/ui/HelperText";

export type FieldSize = "sm" | "md" | "legacy" | "lg";

// Vertical padding per size for the autosizing textarea (legacy = roomier default).
const textareaVerticalPadding: Record<FieldSize, number> = {
  sm: 2,
  md: 2,
  legacy: 6,
  lg: 6,
};

export type BaseFieldProps = {
  label?: ReactNode;
  markRequired?: boolean;
  error?: ReactNode;
  errorLevel?: "error" | "warning";
  helpText?: ReactNode;
  helpTextClassName?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  inputGroupClassName?: string;
  labelClassName?: string;
  customClassName?: string;
  // eslint-disable-next-line
  render?: (id: string, ref: any) => ReactElement;
  minRows?: number;
  maxRows?: number;
  textarea?: boolean;
  prepend?: ReactElement | string;
  append?: ReactElement | string;
  currentLength?: number;
  size?: FieldSize;
};

export type FieldProps = BaseFieldProps &
  Omit<
    React.DetailedHTMLProps<
      React.InputHTMLAttributes<HTMLInputElement>,
      HTMLInputElement
    >,
    "size"
  >;

const Field = forwardRef(
  (
    {
      id,
      className,
      error,
      errorLevel = "error",
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
      type = "text",
      customClassName: customClassNameProp,
      size = "legacy",
      ...otherProps
    }: FieldProps,
    // eslint-disable-next-line
    ref: any,
  ) => {
    const [fieldId] = useState(
      () => id || `field_${Math.floor(Math.random() * 1000000)}`,
    );

    const cn = clsx(
      "form-control",
      `form-control--${size}`,
      {
        "form-control--error": !!error && errorLevel === "error",
        "form-control--warning": !!error && errorLevel === "warning",
      },
      className,
    );

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
          style={{
            paddingTop: textareaVerticalPadding[size],
            paddingBottom: textareaVerticalPadding[size],
            ...(otherProps as unknown as TextareaAutosizeProps).style,
          }}
        />
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
        <div
          className={clsx(
            "input-group",
            `input-group--${size}`,
            inputGroupClassName,
          )}
        >
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

    const customClassName = customClassNameProp || "";
    return (
      <div
        className={clsx(
          "form-group",
          { "mb-0": !label },
          containerClassName,
          render ? customClassName : "",
        )}
        style={containerStyle}
      >
        <div className="d-flex flex-row justify-content-between">
          {label && (
            <label
              htmlFor={fieldId}
              className={clsx(labelClassName)}
              style={{ fontWeight: 600 }}
            >
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
        {error && (
          <HelperText status={errorLevel} mt="1">
            {error}
          </HelperText>
        )}
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
