import {
  cloneElement,
  forwardRef,
  isValidElement,
  PointerEvent,
  useState,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  Text as RadixText,
  Theme,
  TooltipProps as RadixTooltipProps,
} from "@radix-ui/themes";
import clsx from "clsx";

type TooltipProps = Omit<
  RadixTooltipProps,
  "width" | "minWidth" | "maxWidth"
> & {
  width?: string;
  minWidth?: string;
  maxWidth?: string;
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
      content,
      enabled = true,
      confineToTrigger = true,
      open,
      defaultOpen,
      onOpenChange,
      delayDuration,
      disableHoverableContent,
      container,
      forceMount,
      width,
      minWidth,
      maxWidth = "360px",
      className,
      style,
      ...contentProps
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

    // Radix Themes' Tooltip, but its text is a div rather than a p, so the
    // content can hold blocks (rows, lists, paragraphs) without invalid
    // nesting or a paragraph's trailing margin.
    return (
      <TooltipPrimitive.Root
        open={open ?? shown}
        defaultOpen={defaultOpen}
        onOpenChange={(next) => {
          setShown(next);
          onOpenChange?.(next);
        }}
        delayDuration={delayDuration}
        disableHoverableContent={disableHoverableContent}
      >
        <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container} forceMount={forceMount}>
          <Theme asChild>
            <TooltipPrimitive.Content
              sideOffset={4}
              collisionPadding={10}
              {...contentProps}
              ref={ref}
              className={clsx("rt-TooltipContent", className)}
              style={{ width, minWidth, maxWidth, ...style }}
            >
              <RadixText as="div" size="1" className="rt-TooltipText">
                {content}
              </RadixText>
              <TooltipPrimitive.Arrow className="rt-TooltipArrow" />
            </TooltipPrimitive.Content>
          </Theme>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    );
  },
);

Tooltip.displayName = "Tooltip";
export default Tooltip;
