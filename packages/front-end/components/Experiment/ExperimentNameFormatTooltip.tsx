import { ReactNode } from "react";
import { FaInfoCircle } from "react-icons/fa";
import clsx from "clsx";
import Tooltip from "@/components/Tooltip/Tooltip";

type Props = {
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
  body?: ReactNode;
};

export default function ExperimentNameFormatTooltip({
  tipPosition = "top",
  className,
  body,
}: Props) {
  return (
    <Tooltip
      body={
        body ?? (
          <>
            Enter only the <code>&lt;experimentName&gt;</code> portion from the
            naming format{" "}
            <code>exp1:&lt;experimentName&gt;:&lt;variantName&gt;</code>. Do not
            include the <code>exp1:</code> prefix or the variation name.
          </>
        )
      }
      className={clsx("text-muted d-inline-flex align-items-center", className)}
      style={{ cursor: "pointer" }}
      tipPosition={tipPosition}
    >
      <FaInfoCircle />
    </Tooltip>
  );
}
