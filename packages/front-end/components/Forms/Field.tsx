import clsx from "clsx";
import { ReactElement, ReactNode, useState, forwardRef } from "react";
import TextareaAutosize, {
  TextareaAutosizeProps,
} from "react-textarea-autosize";
import HelperText from "@/ui/HelperText";
import { TextWeights } from "@/ui/Text";

const LABEL_FONT_WEIGHTS: Record<TextWeights, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
};

export type FieldSize = "sm" | "md" | "legacy" | "lg";

export type BaseFieldProps = {
  label?: ReactNode;
  markRequired?: boolean;
  error?: ReactNode;
  errorLevel?: "error" | "warning";
  /** The border's state with no message; overrides what `error` would set. */
  outlineStyle?: "default" | "error" | "warning";
  helpText?: ReactNode;
  helpTextClassName?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  inputGroupClassName?: string;
  labelClassName?: string;
  labelWeight?: TextWeights;
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
      outlineStyle,
      helpText,
      helpTextClassName,
      containerClassName,
      containerStyle,
      inputGroupClassName,
      labelClassName,
      labelWeight = "semibold",
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
      // Destructured out of the rest so it isn't spread onto the <input>, which
      // React rejects as an unknown DOM attribute. The counter below uses it.
      currentLength,
      ...otherProps
    }: FieldProps,
    // eslint-disable-next-line
    ref: any,
  ) => {
    const [fieldId] = useState(
      () => id || `field_${Math.floor(Math.random() * 1000000)}`,
    );

    const outline = outlineStyle ?? (error ? errorLevel : "default");
    const cn = clsx(
      "form-control",
      `form-control--${size}`,
      {
        "form-control--error": outline === "error",
        "form-control--warning": outline === "warning",
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
    const labelElement = label ? (
      <label
        htmlFor={fieldId}
        className={clsx(labelClassName)}
        style={{ fontWeight: LABEL_FONT_WEIGHTS[labelWeight] }}
      >
        {label}
        {markRequired && <span className="text-danger ml-1">*</span>}
      </label>
    ) : null;
    const counterElement =
      currentLength !== undefined && otherProps.maxLength ? (
        <div className="font-weight-light">
          <small>{`${currentLength} / ${otherProps.maxLength}`}</small>
        </div>
      ) : null;
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
        {(labelElement || counterElement) && (
          <div className="d-flex flex-row justify-content-between">
            {labelElement}
            {counterElement}
          </div>
        )}
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
