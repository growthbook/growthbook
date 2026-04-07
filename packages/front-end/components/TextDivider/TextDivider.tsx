import clsx from "clsx";
import { FC, ReactNode } from "react";
import Text from "@/ui/Text";
import styles from "./TextDivider.module.scss";

const TextDivider: FC<{
  children: ReactNode;
  width?: number | string;
  className?: string;
}> = ({ children, width = "100%", className }) => {
  return (
    <div className={clsx(styles.outerWrapper, className)}>
      <div className={styles.innerWrapper} style={{ width }}>
        <div className={styles.line} />
        <Text color="text-low" align="center" size="small">
          {children}
        </Text>
        <div className={styles.line} />
      </div>
    </div>
  );
};

export default TextDivider;
