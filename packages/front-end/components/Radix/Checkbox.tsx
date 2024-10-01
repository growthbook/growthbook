import { Flex, Text, Checkbox as RadixCheckbox } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";

export type Props = {
  label: string;
  disabled?: boolean;
  value: boolean;
  setValue: (value: boolean) => void;
} & MarginProps;

export default function Checkbox({
  label,
  disabled,
  value,
  setValue,
  ...containerProps
}: Props) {
  return (
    <Text
      as="label"
      size="2"
      color={disabled ? "gray" : undefined}
      {...containerProps}
    >
      <Flex gap="2">
        <RadixCheckbox
          checked={value}
          onCheckedChange={(v) => setValue(v === true)}
          disabled={disabled}
          color="violet"
        />
        {label}
      </Flex>
    </Text>
  );
}
