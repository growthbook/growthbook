import { Box } from "@radix-ui/themes";
import styles from "./VariationNumber.module.scss";

export default function VariationNumber({ number }: { number: number }) {
  return (
    <Box className={`${styles.variation} ${styles[`variation${number}`]}`}>
      <Box as="span" className={styles.label}>
        {number}
      </Box>
    </Box>
  );
}
