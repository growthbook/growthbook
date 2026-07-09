import { forwardRef } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

type Props = {
  label: string;
  value: React.ReactNode | string;
  style?: React.CSSProperties;
  size?: "small" | "medium";
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, style, size = "medium", ...props },
  ref,
) {
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
