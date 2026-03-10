import { forwardRef, ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";

export type Props = {
  menu: NonNullable<ReactNode>;
  variant?: "solid" | "outline";
  children: NonNullable<ReactNode>;
} & MarginProps;

/** Minimal wrapper for split button. Intended to work for solid purple buttons/menus. No batteries included. **/
const SplitButton = forwardRef<HTMLDivElement, Props>(function SplitButton(
  { menu, variant = "solid", children, ...props }: Props,
  ref,
) {
  return (
    <div className="rt-SplitButton" {...props} ref={ref}>
      <div className={clsx("rt-SplitButtonLeft", variant)}>{children}</div>
      {variant === "solid" && <div className="rt-SplitButtonDivider" />}
      <div className={clsx("rt-SplitButtonRight", variant)}>{menu}</div>
    </div>
  );
});
export default SplitButton;
