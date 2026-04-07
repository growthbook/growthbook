import { forwardRef } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

type Props = {
  label: string;
  value: React.ReactNode | string;
  style?: React.CSSProperties;
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, style, ...props },
  ref,
) {
  const renderLabel = () => {
    return (
      <Text weight="medium" color="text-high">
        {label}
      </Text>
    );
  };
  const renderValue = () => {
    if (typeof value === "string") {
      return (
        <Text weight="regular" color="text-mid">
          {value}
        </Text>
      );
    } else {
      return value;
    }
  };
  return (
    <Flex gap="1" style={style} {...props} ref={ref}>
      <Text weight="medium" color="text-high">
        {renderLabel()}:
      </Text>
      <Text weight="regular" color="text-mid">
        {renderValue()}
      </Text>
    </Flex>
  );
});
