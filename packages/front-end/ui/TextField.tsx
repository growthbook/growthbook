import { Flex, TextField as RadixTextField } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactNode, useId } from "react";
import clsx from "clsx";
import HelperText from "./HelperText";
import Text, { TextSizes, TextWeights } from "./Text";

export type TextFieldSize = "x-small" | "small" | "legacy" | "medium";

/** Supported native input `type` values (passed through to the underlying `<input>`). */
export type TextFieldType =
  | "date"
  | "datetime-local"
  | "email"
  | "hidden"
  | "month"
  | "number"
  | "password"
  | "search"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";

export type TextFieldProps = {
  label?: ReactNode;
  labelSize?: TextSizes;
  labelWeight?: TextWeights;
  /** Visual required indicator on the label. Does not set `required`; pass `required` for HTML validation. */
  markRequired?: boolean;
  error?: string;
  errorLevel?: "error" | "warning";
  helpText?: ReactNode;
  size?: TextFieldSize;
  variant?: "classic" | "surface" | "soft";
  prepend?: ReactNode;
  append?: ReactNode;
  containerClassName?: string;
  inputClassName?: string;
  type?: TextFieldType;
} & Omit<
  React.ComponentPropsWithoutRef<typeof RadixTextField.Root>,
  "size" | "type"
> &
  MarginProps;

function toRadixSize(size: TextFieldSize): "1" | "2" | "3" {
  switch (size) {
    case "x-small":
      return "1";
    case "small":
    case "legacy":
      return "2";
    case "medium":
      return "3";
  }
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      labelSize,
      labelWeight = "semibold",
      markRequired,
      error,
      errorLevel = "error",
      helpText,
      size = "small",
      variant = "surface",
      type = "text",
      prepend,
      append,
      containerClassName,
      inputClassName,
      className,
      id,
      m,
      mx,
      my,
      mt,
      mr,
      mb,
      ml,
      ...inputProps
    },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    const statusClass =
      error && errorLevel === "warning"
        ? "warning"
        : error
          ? "error"
          : undefined;

    return (
      <Flex
        direction="column"
        className={clsx(`gb-text-field--${size}`, containerClassName)}
        m={m}
        mx={mx}
        my={my}
        mt={mt}
        mr={mr}
        mb={mb}
        ml={ml}
      >
        {typeof label === "string" ? (
          <Text
            as="label"
            htmlFor={inputId}
            size={labelSize ?? "medium"}
            weight={labelWeight}
          >
            {label}
            {markRequired ? (
              <span
                style={{ color: "var(--red-11)", marginLeft: "var(--space-1)" }}
              >
                *
              </span>
            ) : null}
          </Text>
        ) : label !== undefined ? (
          label
        ) : null}
        <RadixTextField.Root
          {...inputProps}
          id={inputId}
          ref={ref}
          type={type}
          size={toRadixSize(size)}
          variant={variant}
          className={clsx(className, inputClassName, statusClass)}
        >
          {prepend ? (
            <RadixTextField.Slot side="left">{prepend}</RadixTextField.Slot>
          ) : null}
          {append ? (
            <RadixTextField.Slot side="right">{append}</RadixTextField.Slot>
          ) : null}
        </RadixTextField.Root>
        {error ? (
          <HelperText status={errorLevel} mt="1">
            {error}
          </HelperText>
        ) : helpText ? (
          <Text as="div" size="small" color="text-mid" mt="1">
            {helpText}
          </Text>
        ) : null}
      </Flex>
    );
  },
);

export const TextFieldSlot = RadixTextField.Slot;

export default TextField;
