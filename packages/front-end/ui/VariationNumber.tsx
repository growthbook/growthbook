import { ComponentPropsWithoutRef, forwardRef } from "react";
import { Box } from "@radix-ui/themes";
import styles from "./VariationNumber.module.scss";

type VariationNumberProps = { number: number } & ComponentPropsWithoutRef<
  typeof Box
>;

export default forwardRef<HTMLDivElement, VariationNumberProps>(
  function VariationNumber({ number, className, ...rest }, ref) {
    return (
      <Box
        ref={ref}
        {...rest}
        className={`${styles.variation} ${styles[`variation${number}`]}${
          className ? ` ${className}` : ""
        }`}
      >
        <Box as="span" className={styles.label}>
          {number}
        </Box>
      </Box>
    );
  },
);
