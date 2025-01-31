import { Select as RadixSelect, Text, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactNode } from "react";
import HelperText from "./HelperText";

type SelectProps = {
  label: string;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
  errorLevel?: "error" | "warning";
  value: string;
  setValue: (value: string) => void;
  children: React.ReactNode;
} & MarginProps;

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  {
    label,
    defaultValue,
    disabled = false,
    error,
    errorLevel = "error",
    children,
    value,
    setValue,
    ...containerProps
  }: SelectProps,
  ref
) {
  return (
    <Flex direction="column" {...containerProps} ref={ref}>
      <Text as="label" size="3" weight="medium">
        {label}
      </Text>
      <RadixSelect.Root
        defaultValue={defaultValue}
        size="3"
        disabled={disabled}
        value={value}
        onValueChange={setValue}
      >
        <RadixSelect.Trigger
          className={error ? "error" : undefined}
          disabled={disabled}
          variant="surface"
        />
        <RadixSelect.Content variant="soft" position="popper">
          {children}
        </RadixSelect.Content>
      </RadixSelect.Root>
      {error && (
        <HelperText status={errorLevel} mt="1">
          {error}
        </HelperText>
      )}
    </Flex>
  );
});

export const SelectItem = forwardRef<
  HTMLDivElement,
  {
    value: string;
    children: string | string[] | ReactNode;
    disabled?: boolean;
  }
>(function SelectItem({ value, children, disabled = false, ...props }, ref) {
  return (
    <RadixSelect.Item value={value} disabled={disabled} {...props} ref={ref}>
      {children}
    </RadixSelect.Item>
  );
});

export const SelectSeparator = forwardRef<HTMLDivElement>(
  function SelectSeparator(props, ref) {
    return <RadixSelect.Separator {...props} ref={ref} />;
  }
);
