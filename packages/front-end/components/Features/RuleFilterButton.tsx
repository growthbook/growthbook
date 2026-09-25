import { forwardRef, ReactNode } from "react";
import clsx from "clsx";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./RuleFilterButton.module.scss";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 12px icon. Stroke weight and size are the caller's to set. */
  icon: ReactNode;
  /** Accessible name, and the tooltip body. */
  label: string;
  /**
   * Lights the control violet. Pass the condition under which rules are
   * genuinely being hidden, not the raw state of a toggle.
   */
  active?: boolean;
  spinning?: boolean;
}

/**
 * Local to the Rules section on purpose — it is not in `@/ui` because a 26px
 * bordered icon control is not (yet) a design-system primitive, and promoting
 * it would imply an API the rest of the app has not agreed to.
 */
/**
 * The same chrome, as a class name.
 *
 * `@/ui/DropdownMenu` renders its own `<button>` for the trigger and does not
 * use `asChild`, so a menu trigger styles that button via `triggerClassName`
 * rather than nesting another button inside it.
 */
export function ruleFilterTriggerClass(active: boolean): string {
  return clsx(styles.ruleFilterButton, active && styles.active);
}

const RuleFilterButton = forwardRef<HTMLButtonElement, Props>(
  function RuleFilterButton(
    { icon, label, active = false, spinning = false, className, ...rest },
    ref,
  ) {
    return (
      <Tooltip body={label} tipPosition="top">
        <button
          {...rest}
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={clsx(
            styles.ruleFilterButton,
            active && styles.active,
            className,
          )}
        >
          <span className={clsx(spinning && styles.spinning)}>{icon}</span>
        </button>
      </Tooltip>
    );
  },
);

export default RuleFilterButton;
