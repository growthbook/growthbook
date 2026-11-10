import { ReactNode } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Link from "@/ui/Link";

// The small link at the foot of the targeting tables that shows or hides
// their details.
export default function TargetingDetailsLink({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Link
      size="sm"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        onOpenChange(!open);
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        {open ? <PiCaretDown /> : <PiCaretRight />}
      </span>
    </Link>
  );
}
