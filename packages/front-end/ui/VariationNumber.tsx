import { forwardRef } from "react";
import { Box } from "@radix-ui/themes";
import styles from "./VariationNumber.module.scss";

export default forwardRef<HTMLDivElement, { number: number }>(
  function VariationNumber({ number }, ref) {
    return (
      <Box
        ref={ref}
        className={`${styles.variation} ${styles[`variation${number}`]}`}
      >
        <Box as="span" className={styles.label}>
          {number}
        </Box>
      </Box>
    );
  },
);
