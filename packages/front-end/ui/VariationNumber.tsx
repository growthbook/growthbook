import { ComponentPropsWithoutRef, forwardRef } from "react";
import { Box } from "@radix-ui/themes";
import styles from "./VariationNumber.module.scss";

type VariationNumberProps = { number: number } & ComponentPropsWithoutRef<
  typeof Box
>;

// The `1`'s flag makes it look left-heavy when its text box is centered.
const digitOpticalOffsets = new Map<string, number>([["1", 0.5]]);

function getOpticalOffset(number: number): number {
  const digits = String(number);

  return (
    [...digits].reduce(
      (offset, digit) => offset + (digitOpticalOffsets.get(digit) ?? 0),
      0,
    ) / digits.length
  );
}

export default forwardRef<HTMLDivElement, VariationNumberProps>(
  function VariationNumber({ number, className, ...rest }, ref) {
    const opticalOffset = getOpticalOffset(number);

    return (
      <Box
        ref={ref}
        {...rest}
        className={`${styles.variation} ${styles[`variation${number}`]}${
          className ? ` ${className}` : ""
        }`}
      >
        <Box as="span" className={styles.label}>
          <span
            className={styles.number}
            style={{ transform: `translateX(${opticalOffset}px)` }}
          >
            {number}
          </span>
        </Box>
      </Box>
    );
  },
);
