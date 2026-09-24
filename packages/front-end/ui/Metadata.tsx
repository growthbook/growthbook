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
  /**
   * Label beside the value, in a column of its own, so a list of rows lines
   * up down the label side. For a narrow column that stacking would stretch.
   */
  row?: boolean;
  /** A stacked or row layout's own control, such as its edit button. */
  action?: React.ReactNode;
  /** Straight after the label, or straight after the value. */
  actionPlacement?: "label" | "value";
};

// Gives way in a narrow column, so the value keeps room to read.
const ROW_LABEL_WIDTH = "min(120px, 40%)";
// Tall enough for an avatar, a tag or an edit button, so a row carrying one
// keeps the same rhythm as a row of plain text.
const ROW_MIN_HEIGHT = 22;

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  {
    label,
    value,
    style,
    size = "md",
    stacked,
    row,
    action,
    actionPlacement = "label",
    ...props
  },
  ref,
) {
  const valueNode =
    typeof value === "string" ? (
      <Text weight="regular" color="text-high" size={size}>
        {value}
      </Text>
    ) : (
      value
    );

  if (row) {
    return (
      <Flex
        gap="3"
        align="baseline"
        style={{ minHeight: ROW_MIN_HEIGHT, ...style }}
        data-reveals-action={action ? "" : undefined}
        {...props}
        ref={ref}
      >
        <Flex align="center" gap="1" flexShrink="0" width={ROW_LABEL_WIDTH}>
          <Text weight="regular" color="text-low" size={size}>
            {label}
          </Text>
          {actionPlacement === "label" ? action : null}
        </Flex>
        <Flex align="center" gap="1" flexGrow="1" minWidth="0">
          {valueNode}
          {actionPlacement === "value" ? action : null}
        </Flex>
      </Flex>
    );
  }

  if (stacked) {
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
          <Flex align="center" gap="1">
            <Text weight="regular" color="text-low" size={size}>
              {label}
            </Text>
            {action}
          </Flex>
        ) : (
          <Text weight="regular" color="text-low" size={size}>
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
