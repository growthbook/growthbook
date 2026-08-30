import clsx from "clsx";
import { Tooltip } from "@radix-ui/themes";
import Link from "@/ui/Link";
import { ChartLineExploreIcon } from "./Icons";
import styles from "./TimeSeriesButton.module.scss";

type TimeSeriesButtonProps = {
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  isActive: boolean;
};

function TimeSeriesButton({ onClick, isActive }: TimeSeriesButtonProps) {
  return (
    <Tooltip content="Explore time series for this metric">
      <Link
        onClick={onClick}
        className={clsx(styles.timeSeriesButton, {
          [styles.active]: isActive,
        })}
      >
        <ChartLineExploreIcon />
      </Link>
    </Tooltip>
  );
}

export default TimeSeriesButton;
