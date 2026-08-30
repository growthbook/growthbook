import { forwardRef, Fragment, ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";

export type Props = {
  // Optional trailing segment. When provided it always gets the "right" segment
  // treatment (e.g. a dropdown chevron). When omitted, the last of `children`
  // becomes the right segment instead.
  menu?: ReactNode;
  variant?: "solid" | "outline";
  className?: string;
  // One or more segments. A single child renders a normal button; an array is
  // chopped into split-button segments (first = left, last = right, rest =
  // middle), with dividers between them for the solid variant.
  children: NonNullable<ReactNode | ReactNode[]>;
} & MarginProps;

/** Minimal wrapper for split button. Intended to work for solid purple buttons/menus. No batteries included. **/
const SplitButton = forwardRef<HTMLDivElement, Props>(function SplitButton(
  { menu, variant = "solid", className, children, ...props }: Props,
  ref,
) {
  const childArray = (Array.isArray(children) ? children : [children]).filter(
    (c) => c !== null && c !== undefined && c !== false,
  );
  const items = menu != null ? [...childArray, menu] : childArray;

  return (
    <div className={clsx("rt-SplitButton", className)} {...props} ref={ref}>
      {items.map((item, i) => {
        // A lone segment renders bare so it keeps its own rounded corners.
        if (items.length === 1) return <Fragment key={i}>{item}</Fragment>;
        const segment =
          i === 0
            ? "rt-SplitButtonLeft"
            : i === items.length - 1
              ? "rt-SplitButtonRight"
              : "rt-SplitButtonMiddle";
        return (
          <Fragment key={i}>
            {i > 0 && variant === "solid" && (
              <div className="rt-SplitButtonDivider" />
            )}
            <div className={clsx(segment, variant)}>{item}</div>
          </Fragment>
        );
      })}
    </div>
  );
});
export default SplitButton;
