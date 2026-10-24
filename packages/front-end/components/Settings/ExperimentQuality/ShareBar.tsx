import { FC } from "react";
import { Slider } from "@radix-ui/themes";
import styles from "./ExperimentQuality.module.scss";

const ShareBar: FC<{
  value: number; // 0-100 integer share
  onChange: (value: number) => void;
  color: string; // css color for fill + handle ring
  ariaLabel: string;
}> = ({ value, onChange, color, ariaLabel }) => {
  return (
    <Slider
      className={styles.shareBar}
      style={{ "--share-bar-color": color } as React.CSSProperties}
      value={[value]}
      min={0}
      max={100}
      step={1}
      onValueChange={(v) => onChange(v[0])}
      aria-label={ariaLabel}
      radius="full"
      size="1"
    />
  );
};

export default ShareBar;
