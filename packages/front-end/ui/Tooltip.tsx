import {
  cloneElement,
  forwardRef,
  isValidElement,
  PointerEvent,
  useState,
} from "react";
import {
  Tooltip as RadixTooltip,
  TooltipProps as RadixTooltipProps,
} from "@radix-ui/themes";

type TooltipProps = RadixTooltipProps & {
  enabled?: boolean;
  // Opens only over the trigger's own box, not a pseudo-element stretched
  // from it (e.g. one that makes a whole row click the trigger).
  confineToTrigger?: boolean;
};

type PointerHandler = (event: PointerEvent<HTMLElement>) => void;

function overOwnBox({
  currentTarget,
  clientX,
  clientY,
}: PointerEvent<HTMLElement>) {
  const box = currentTarget.getBoundingClientRect();
  // A trigger with no box of its own can't be told apart from what's around it.
  if (!box.width && !box.height) return true;
  return (
    clientX >= box.left &&
    clientX <= box.right &&
    clientY >= box.top &&
    clientY <= box.bottom
  );
}

const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      children,
      enabled = true,
      confineToTrigger = true,
      open,
      onOpenChange,
      ...props
    },
    ref,
  ) => {
    const [shown, setShown] = useState(false);
    // Otherwise a tooltip disabled while open reopens, unhovered, when enabled.
    if (!enabled && shown) setShown(false);

    if (!enabled) {
      return <>{children}</>;
    }

    const trigger =
      confineToTrigger &&
      isValidElement<{ onPointerMove?: PointerHandler }>(children)
        ? cloneElement(children, {
            onPointerMove: (event: PointerEvent<HTMLElement>) => {
              children.props.onPointerMove?.(event);
              if (overOwnBox(event)) return;
              event.preventDefault();
              setShown(false);
            },
          })
        : children;

    return (
      <RadixTooltip
        {...props}
        open={open ?? shown}
        onOpenChange={(next) => {
          setShown(next);
          onOpenChange?.(next);
        }}
        ref={ref}
      >
        {trigger}
      </RadixTooltip>
    );
  },
);

Tooltip.displayName = "Tooltip";
export default Tooltip;
