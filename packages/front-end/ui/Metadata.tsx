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
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, style, size = "md", stacked, ...props },
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
        <Text weight="regular" color="text-mid" size={size}>
          {label}
        </Text>
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
