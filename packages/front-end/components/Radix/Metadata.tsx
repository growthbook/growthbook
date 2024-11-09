// react component for metadata that would display like title: data

import { FC } from "react";
import { Flex, Text } from "@radix-ui/themes";
import styles from "./Styles/Metadata.module.scss";

const Metadata: FC<{
  label: string;
  value: React.ReactNode | string;
}> = ({ label, value }) => {
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
    <Flex gap="1">
      <span className={styles.titleColor}>{renderLabel()}:</span>
      <span className={styles.dataColor}>{renderValue()}</span>
    </Flex>
  );
};
export default Metadata;
