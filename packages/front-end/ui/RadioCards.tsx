import {
  Flex,
  Text,
  RadioCards as RadixRadioCards,
  TextProps,
} from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactElement } from "react";
import Badge from "@/ui/Badge";

export type RadioOptions = {
  value: string;
  label?: ReactElement | string;
  avatar?: ReactElement;
  description?: ReactElement | string;
  disabled?: boolean;
  badge?: ReactElement | string;
}[];

export type Props = {
  disabled?: boolean;
  columns?: "1" | "2" | "3" | "4" | "5" | "6";
  width?: string;
  options: RadioOptions;
  align?: "start" | "center" | "end";
  icon?: ReactElement;
  value: string;
  setValue: (value: string) => void;
  onClick?: () => void;
  labelSize?: TextProps["size"];
  labelWeight?: TextProps["weight"];
  descriptionSize?: TextProps["size"];
  descriptionWeight?: TextProps["weight"];
  truncateDescription?: boolean;
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function RadioCards(
  {
    disabled,
    columns = "1",
    width = "auto",
    options,
    value,
    setValue,
    align,
    onClick,
    labelSize = "3",
    labelWeight = "bold",
    descriptionSize = "2",
    descriptionWeight = "regular",
    truncateDescription = true,
    ...containerProps
  }: Props,
  ref,
) {
  return (
    <Flex {...containerProps} ref={ref}>
      <Text size="2" color={disabled ? "gray" : undefined} style={{ width }}>
        <RadixRadioCards.Root
          value={value}
          onValueChange={(val) => setValue(val)}
          disabled={disabled}
          columns={columns}
          onClick={onClick}
        >
          {options.map(
            ({ value, label, avatar, description, disabled, badge }) => {
              return (
                <RadixRadioCards.Item
                  key={value}
                  value={value}
                  disabled={disabled}
                  className={disabled ? "disabled" : undefined}
                >
                  <Flex direction="row" width="100%" gap="3" align={align}>
                    {avatar}
                    <Flex
                      direction="column"
                      gap="1"
                      style={{ minWidth: 0, flex: 1 }}
                    >
                      <Flex direction="row" gap="3">
                        <Text
                          weight={labelWeight}
                          size={labelSize}
                          className="main-text truncate"
                          style={{ minWidth: 0 }}
                        >
                          {label || value}
                        </Text>
                        {badge ? <Badge label={badge} /> : null}
                      </Flex>
                      {description ? (
                        <Text
                          weight={descriptionWeight}
                          size={descriptionSize}
                          className={
                            truncateDescription ? "truncate" : undefined
                          }
                          style={{
                            minWidth: 0,
                            color: "var(--color-text-mid)",
                          }}
                        >
                          {description}
                        </Text>
                      ) : null}
                    </Flex>
                  </Flex>
                </RadixRadioCards.Item>
              );
            },
          )}
        </RadixRadioCards.Root>
      </Text>
    </Flex>
  );
});
