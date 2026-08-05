import { ReactNode } from "react";
import { PiProhibitInset } from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import HelperText, { Size } from "@/ui/HelperText";

/**
 * The one way a permission denial is explained next to a disabled control:
 * amber with a crossed circle, distinct from informational notes (violet info)
 * and from revision locks (PiLock), which apply to everyone rather than to
 * this viewer.
 */
export default function PermissionBlocker({
  children,
  size = "sm",
  ...margins
}: {
  children: ReactNode;
  size?: Size;
} & MarginProps) {
  return (
    <HelperText
      status="warning"
      size={size}
      icon={<PiProhibitInset size={size === "sm" ? 13 : 15} />}
      {...margins}
    >
      {children}
    </HelperText>
  );
}
