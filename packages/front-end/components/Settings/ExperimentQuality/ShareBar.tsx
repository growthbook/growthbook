import { FC } from "react";
import { Slider } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./ExperimentQuality.module.scss";

// Draggable share bar: rounded track, colored fill, white handle ringed in
// the bar color. Callers re-flow sibling shares on change.
const ShareBar: FC<{
  value: number; // 0-100 integer share
  onChange: (value: number) => void;
  color: string; // css color for fill + handle ring
  variant: "section" | "check";
  ariaLabel: string;
}> = ({ value, onChange, color, variant, ariaLabel }) => {
  return (
    <Slider
      className={clsx(
        styles.shareBar,
        variant === "section" ? styles.sectionBar : styles.checkBar,
      )}
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
