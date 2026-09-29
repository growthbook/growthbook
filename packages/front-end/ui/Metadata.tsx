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
  /** Straight after the label, or straight after the value. */
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
    const labelNode = (
      <Text weight="regular" color="text-low" size={size}>
        {label}
      </Text>
    );
    const valueNode =
      typeof value === "string" ? (
        <Text weight="regular" color="text-high" size={size}>
          {value}
        </Text>
      ) : (
        value
      );
    const withAction = (
      node: React.ReactNode,
      placement: typeof actionPlacement,
    ) =>
      action && actionPlacement === placement ? (
        <Flex align="center" gap="1">
          {node}
          {action}
        </Flex>
      ) : (
        node
      );

    return (
      <Flex
        direction="column"
        gap="1"
        align="start"
        style={style}
        // Hovering the row reveals its action.
        data-reveals-action={action ? "" : undefined}
        {...props}
        ref={ref}
      >
        {withAction(labelNode, "label")}
        {withAction(valueNode, "value")}
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
