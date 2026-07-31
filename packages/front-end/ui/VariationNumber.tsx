import { ComponentPropsWithoutRef, forwardRef } from "react";
import { Box } from "@radix-ui/themes";
import styles from "./VariationNumber.module.scss";

type VariationNumberProps = { number: number } & ComponentPropsWithoutRef<
  typeof Box
>;

type DigitEdgeMetrics = {
  actualLeft: number;
  trailingSpace: number;
};

// Canvas text metrics for Inter 500 at 11px, matching VariationNumber.module.scss.
const interDigitEdgeMetrics = new Map<string, DigitEdgeMetrics>([
  ["0", { actualLeft: -0.605, trailingSpace: 0.605 }],
  ["1", { actualLeft: -0.51, trailingSpace: 0.886 }],
  ["2", { actualLeft: -0.764, trailingSpace: 0.722 }],
  ["3", { actualLeft: -0.624, trailingSpace: 0.605 }],
  ["4", { actualLeft: -0.61, trailingSpace: 0.587 }],
  ["5", { actualLeft: -0.626, trailingSpace: 0.605 }],
  ["6", { actualLeft: -0.605, trailingSpace: 0.605 }],
  ["7", { actualLeft: -0.486, trailingSpace: 0.486 }],
  ["8", { actualLeft: -0.605, trailingSpace: 0.605 }],
  ["9", { actualLeft: -0.605, trailingSpace: 0.605 }],
]);

function getOpticalOffset(number: number): number {
  const digits = String(number);
  const firstDigit = interDigitEdgeMetrics.get(digits.charAt(0));
  const lastDigit = interDigitEdgeMetrics.get(digits.charAt(digits.length - 1));

  if (!firstDigit || !lastDigit) return 0;

  return (firstDigit.actualLeft + lastDigit.trailingSpace) / 2;
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
