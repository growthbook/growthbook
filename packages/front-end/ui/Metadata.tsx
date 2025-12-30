import { forwardRef } from "react";
import { Flex, Text } from "@radix-ui/themes";
import styles from "./Metadata.module.scss";

type Props = {
  label: string;
  value: React.ReactNode | string;
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, ...props },
  ref,
) {
  const renderLabel = () => {
    return (
      <Text weight="medium" className={styles.labelColor}>
        {label}
      </Text>
    );
  };
  const renderValue = () => {
    if (typeof value === "string") {
      return (
        <Text weight="regular" className={styles.valueColor}>
          {value}
        </Text>
      );
    } else {
      return value;
    }
  };
  return (
    <Flex gap="1" {...props} ref={ref}>
      <span className={styles.titleColor}>{renderLabel()}:</span>
      <span className={styles.dataColor}>{renderValue()}</span>
    </Flex>
  );
});
