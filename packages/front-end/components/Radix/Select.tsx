import { Select as RadixSelect, Text, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props";
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

export function Select({
  label,
  defaultValue,
  disabled = false,
  error,
  errorLevel = "error",
  children,
  value,
  setValue,
  ...containerProps
}: SelectProps) {
  return (
    <Flex direction="column" {...containerProps}>
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
}

export function SelectItem({
  value,
  children,
  disabled = false,
}: {
  value: string;
  children: string;
  disabled?: boolean;
}) {
  return (
    <RadixSelect.Item value={value} disabled={disabled}>
      {children}
    </RadixSelect.Item>
  );
}

export function SelectSeparator() {
  return <RadixSelect.Separator />;
}
