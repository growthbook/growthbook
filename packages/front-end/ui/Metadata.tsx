import { forwardRef } from "react";
import { Flex } from "@radix-ui/themes";
import { Size } from "@/ui/sizes";
import Text from "@/ui/Text";

type Props = {
  label: string;
  value: React.ReactNode | string;
  style?: React.CSSProperties;
  size?: Size<"sm" | "md">;
  /** Label above the value, for a narrow column. Otherwise inline "Label: value". */
  stacked?: boolean;
  /** A stacked row's own control, such as its edit button. */
  action?: React.ReactNode;
  /**
   * `label`: at the far end of the label's row, for a value that fills the
   * width anyway. `value`: straight after the value, for a short one.
   */
  actionPlacement?: "label" | "value";
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  {
    label,
    value,
    style,
    size = "md",
    stacked,
    action,
    actionPlacement = "label",
    ...props
  },
  ref,
) {
  if (stacked) {
    const valueNode =
      typeof value === "string" ? (
        <Text weight="regular" color="text-high" size={size}>
          {value}
        </Text>
      ) : (
        value
      );
    return (
      <Flex
        direction="column"
        gap="1"
        align="start"
        style={style}
        // Where a row's action lives, hovering the row is what reveals it.
        data-reveals-action={action ? "" : undefined}
        {...props}
        ref={ref}
      >
        {action && actionPlacement === "label" ? (
          <Flex align="center" justify="between" gap="2" width="100%">
            <Text weight="regular" color="text-mid" size={size}>
              {label}
            </Text>
            {action}
          </Flex>
        ) : (
          <Text weight="regular" color="text-mid" size={size}>
            {label}
          </Text>
        )}
        {action && actionPlacement === "value" ? (
          <Flex align="center" gap="1">
            {valueNode}
            {action}
          </Flex>
        ) : (
          valueNode
        )}
      </Flex>
    );
  }

  return (
    <Flex gap="1" align="center" style={style} {...props} ref={ref}>
      <Text weight="medium" color="text-high" size={size}>
        {label}:
      </Text>
      {typeof value === "string" ? (
        <Text weight="regular" color="text-mid" size={size}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Flex>
  );
});
