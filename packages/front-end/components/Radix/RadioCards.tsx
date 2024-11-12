import { Flex, Text, RadioCards as RadixRadioCards } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { ReactElement } from "react";

export type RadioOptions = {
  value: string;
  label?: ReactElement | string;
  avatar?: ReactElement;
  description?: ReactElement | string;
  disabled?: boolean;
}[];

export type Props = {
  disabled?: boolean;
  columns?: "1" | "2" | "3" | "4" | "5" | "6";
  width?: string;
  options: RadioOptions;
  align?: "start" | "center" | "end";
  value: string;
  setValue: (value: string) => void;
} & MarginProps;

export default function RadioCards({
  disabled,
  columns = "1",
  width = "auto",
  options,
  value,
  setValue,
  align,
  ...containerProps
}: Props) {
  return (
    <Flex {...containerProps}>
      <Text size="2" color={disabled ? "gray" : undefined} style={{ width }}>
        <RadixRadioCards.Root
          value={value}
          onValueChange={(val) => setValue(val)}
          disabled={disabled}
          columns={columns}
        >
          {options.map(({ value, label, avatar, description, disabled }) => {
            return (
              <RadixRadioCards.Item
                key={value}
                value={value}
                disabled={disabled}
                className={disabled ? "disabled" : undefined}
              >
                <Flex direction="row" width="100%" gap="3" align={align}>
                  {avatar}
                  <Flex direction="column" gap="1">
                    <Text weight="bold" size="3" className="main-text">
                      {label || value}
                    </Text>
                    {description ? (
                      <Text weight="regular" size="2">
                        {description}
                      </Text>
                    ) : null}
                  </Flex>
                </Flex>
              </RadixRadioCards.Item>
            );
          })}
        </RadixRadioCards.Root>
      </Text>
    </Flex>
  );
}
