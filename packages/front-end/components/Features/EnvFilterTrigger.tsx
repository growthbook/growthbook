import clsx from "clsx";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./EnvFilterTrigger.module.scss";

export default function EnvFilterTrigger({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const tooltipBody =
    label === "All Environments"
      ? "Show all rules across every environment"
      : `Filter rules by "${label}" environment`;

  return (
    <Tooltip body={tooltipBody} tipPosition="bottom">
      <button className={clsx("rt-reset", styles.trigger)} onClick={onClick}>
        <Badge
          label={
            <>
              <span title={label}>{label}</span>
              <Badge
                ml="2"
                label={String(count)}
                radius="full"
                variant="solid"
                color="violet"
                size="xs"
              />
            </>
          }
          color="violet"
          variant="outline"
          radius="full"
          size="lg"
          className={clsx(styles.badge, { [styles.badgeInactive]: !isActive })}
        />
      </button>
    </Tooltip>
  );
}
