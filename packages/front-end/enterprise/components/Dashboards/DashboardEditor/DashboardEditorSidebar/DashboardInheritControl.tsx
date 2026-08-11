import clsx from "clsx";
import Button from "@/ui/Button";
import styles from "./DashboardInheritControl.module.scss";

interface Props {
  // Names the filter for screen readers and the segment tooltips, e.g. "Metric".
  label: string;
  // True when this field follows the dashboard's filter.
  inherited: boolean;
  onChange: (inherited: boolean) => void;
  disabled?: boolean;
}

/**
 * Per-field choice between inheriting a dashboard filter and setting the block's
 * own value. Replaces the old "Use dashboard …" switch: two labelled segments
 * read unambiguously at a glance, where a switch left you working out what "off"
 * meant. Rendered on the right of a field's label row (see SidebarSettingField
 * `accessory`); the field control itself is disabled while inheriting.
 *
 * Each segment is a ghost @/ui/Button squeezed down to badge size by the module's
 * `.segment` class, with `aria-pressed` carrying the on/off state.
 */
export default function DashboardInheritControl({
  label,
  inherited,
  onChange,
  disabled,
}: Props) {
  return (
    <div
      className={styles.group}
      role="group"
      aria-label={`${label} filter source`}
    >
      <Button
        variant="ghost"
        color="gray"
        size="sm"
        className={clsx(styles.segment, { [styles.activeCustom]: !inherited })}
        aria-pressed={!inherited}
        disabled={disabled}
        title={`Set ${label} just for this block`}
        onClick={() => onChange(false)}
      >
        Custom
      </Button>
      <Button
        variant="ghost"
        color="gray"
        size="sm"
        className={clsx(styles.segment, { [styles.active]: inherited })}
        aria-pressed={inherited}
        disabled={disabled}
        title={`Follow the dashboard's ${label} filter`}
        onClick={() => onChange(true)}
      >
        Inherit
      </Button>
    </div>
  );
}
