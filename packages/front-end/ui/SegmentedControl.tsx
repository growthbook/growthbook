import { SegmentedControl as RadixSegmentedControl } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";

// "normal", between sm and md and off the shared ladder, is sm with breathing
// room, for legibility.
type SegmentedControlSize = Size<"sm" | "md" | "lg"> | "normal";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: ReactNode;
  // Names an icon-only segment.
  ariaLabel?: string;
};

const INDICATOR_X = "--gb-segmented-control-indicator-x";
const INDICATOR_WIDTH = "--gb-segmented-control-indicator-width";

// Radix spaces its indicator evenly, which wrapped segments outgrow. Only a new
// selection slides.
function placeIndicator(root: HTMLElement, animate: boolean) {
  const on = root.querySelector<HTMLElement>(
    '.rt-SegmentedControlItem[data-state="on"]',
  );
  const indicator = root.querySelector<HTMLElement>(
    ".rt-SegmentedControlIndicator",
  );
  const rootRect = root.getBoundingClientRect();
  // Hidden: measured once it shows.
  if (!on || !indicator || !rootRect.width) return;
  const onRect = on.getBoundingClientRect();
  const x = `${onRect.left - rootRect.left}px`;
  const width = `${onRect.width}px`;
  if (
    root.style.getPropertyValue(INDICATOR_X) === x &&
    root.style.getPropertyValue(INDICATOR_WIDTH) === width
  ) {
    return;
  }
  const snap = !animate || root.dataset.indicatorPlaced === undefined;
  if (snap) indicator.style.transition = "none";
  root.style.setProperty(INDICATOR_X, x);
  root.style.setProperty(INDICATOR_WIDTH, width);
  root.dataset.indicatorPlaced = "";
  if (snap) {
    void indicator.offsetWidth;
    indicator.style.transition = "";
  }
}

export default function SegmentedControl<T extends string>({
  value,
  setValue,
  options,
  size = "md",
  wrap = false,
  "aria-label": ariaLabel,
  ...marginProps
}: {
  value: T;
  setValue: (value: NoInfer<T>) => void;
  options: SegmentedControlOption<NoInfer<T>>[];
  size?: SegmentedControlSize;
  // Long labels wrap rather than overflow.
  wrap?: boolean;
  "aria-label": string;
} & MarginProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (wrap && rootRef.current) placeIndicator(rootRef.current, true);
  }, [wrap, value]);

  useEffect(() => {
    const root = rootRef.current;
    if (!wrap || !root) return;
    const observer = new ResizeObserver(() => placeIndicator(root, false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [wrap]);

  return (
    <RadixSegmentedControl.Root
      ref={rootRef}
      {...marginProps}
      size={radixSize(size === "normal" ? "sm" : size)}
      value={value}
      onValueChange={(v) => setValue(v as T)}
      aria-label={ariaLabel}
      className={clsx("gb-segmented-control", {
        "gb-segmented-control--normal": size === "normal",
        "gb-segmented-control--wrap": wrap,
      })}
    >
      {options.map((o) => (
        <RadixSegmentedControl.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
        >
          {o.label}
        </RadixSegmentedControl.Item>
      ))}
    </RadixSegmentedControl.Root>
  );
}
