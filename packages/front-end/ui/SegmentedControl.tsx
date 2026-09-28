import { SegmentedControl as RadixSegmentedControl } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { ReactNode, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Names an icon-only segment. */
  ariaLabel?: string;
};

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
  size?: Size<"sm" | "md" | "lg">;
  /** Long labels wrap onto more lines rather than overflow a narrow container. */
  wrap?: boolean;
  "aria-label": string;
} & MarginProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Wrapped segments can differ in width, which Radix's evenly spaced indicator can't follow.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!wrap || !root) return;
    const place = () => {
      const on = root.querySelector<HTMLElement>(
        '.rt-SegmentedControlItem[data-state="on"]',
      );
      if (!on) return;
      const rootRect = root.getBoundingClientRect();
      const onRect = on.getBoundingClientRect();
      root.style.setProperty(
        "--gb-segmented-control-indicator-x",
        `${onRect.left - rootRect.left}px`,
      );
      root.style.setProperty(
        "--gb-segmented-control-indicator-width",
        `${onRect.width}px`,
      );
      root.dataset.indicatorPlaced = "";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [wrap, value]);

  return (
    <RadixSegmentedControl.Root
      ref={rootRef}
      {...marginProps}
      size={radixSize(size)}
      value={value}
      onValueChange={(v) => setValue(v as T)}
      aria-label={ariaLabel}
      className={clsx("gb-segmented-control", {
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
