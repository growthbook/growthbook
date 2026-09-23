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
  /** Sits at the far end of a stacked label's row, such as its edit button. */
  action?: React.ReactNode;
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, style, size = "md", stacked, action, ...props },
  ref,
) {
  if (stacked) {
    return (
      <Flex
        direction="column"
        gap="1"
        align="start"
        style={style}
        {...props}
        ref={ref}
      >
        {action ? (
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
        {typeof value === "string" ? (
          <Text weight="regular" color="text-high" size={size}>
            {value}
          </Text>
        ) : (
          value
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
