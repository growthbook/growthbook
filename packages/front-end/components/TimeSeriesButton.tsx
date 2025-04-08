import { forwardRef } from "react";
import clsx from "clsx";
import Link from "@/components/Radix/Link";
import { ChartLineExploreIcon } from "./Icons";
import styles from "./TimeSeriesButton.module.scss";

const TimeSeriesButton = forwardRef<
  HTMLAnchorElement,
  {
    onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    isActive: boolean;
  }
>(function TimeSeriesButton({ onClick, isActive }, ref) {
  return (
    <Link
      ref={ref}
      onClick={onClick}
      className={clsx(styles.timeSeriesButton, {
        [styles.active]: isActive,
      })}
    >
      <ChartLineExploreIcon />
    </Link>
  );
});

export default TimeSeriesButton;
