import {
  Flex,
  Text,
  RadioCards as RadixRadioCards,
  TextProps,
  Tooltip,
} from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import { forwardRef, ReactElement, ReactNode } from "react";
import Badge from "@/ui/Badge";
import { radixSize, Size } from "@/ui/sizes";
import Collapse from "@/ui/Collapse";
import styles from "./RadioCards.module.scss";

export type RadioOptions = {
  value: string;
  label?: ReactElement | string;
  avatar?: ReactElement;
  description?: ReactElement | string;
  disabled?: boolean;
  badge?: ReactElement | string;
  tooltip?: string;
  // Shown under the card while it's selected, e.g. a follow-up choice.
  selectedContent?: ReactNode;
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
  labelSize?: Size<"sm" | "md" | "lg" | "xl">;
  labelWeight?: TextProps["weight"];
  descriptionSize?: Size<"sm" | "md" | "lg" | "xl">;
  descriptionWeight?: TextProps["weight"];
  truncateDescription?: boolean;
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function RadioCards(
  {
    disabled,
    columns = "1",
    width = "auto",
    options,
    value: selected,
    setValue,
    align,
    onClick,
    labelSize = "lg",
    labelWeight = "bold",
    descriptionSize = "md",
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
          value={selected}
          onValueChange={(val) => setValue(val)}
          disabled={disabled}
          columns={columns}
          onClick={onClick}
        >
          {options.map(
            ({
              value,
              label,
              avatar,
              description,
              disabled,
              badge,
              tooltip,
              selectedContent,
            }) => {
              const item = (
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
                          size={radixSize(labelSize)}
                          className="main-text truncate"
                          style={{ minWidth: 0 }}
                          title={typeof label === "string" ? label : undefined}
                        >
                          {label || value}
                        </Text>
                        {badge ? <Badge label={badge} /> : null}
                      </Flex>
                      {description ? (
                        <Text
                          weight={descriptionWeight}
                          size={radixSize(descriptionSize)}
                          className={
                            truncateDescription ? "truncate" : undefined
                          }
                          style={{ minWidth: 0 }}
                        >
                          {description}
                        </Text>
                      ) : null}
                    </Flex>
                  </Flex>
                </RadixRadioCards.Item>
              );

              const card = tooltip ? (
                <Tooltip key={value} content={tooltip} side="top">
                  {item}
                </Tooltip>
              ) : (
                item
              );
              if (!selectedContent) return card;
              // Always wrapped, so selecting the card doesn't remount it.
              const isSelected = value === selected;
              return (
                <div
                  key={value}
                  className={clsx(styles.option, isSelected && styles.group)}
                >
                  {card}
                  <Collapse open={isSelected} duration={150}>
                    <div className={styles.selectedContent}>
                      {selectedContent}
                    </div>
                  </Collapse>
                </div>
              );
            },
          )}
        </RadixRadioCards.Root>
      </Text>
    </Flex>
  );
});
