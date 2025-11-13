import { FaInfoCircle } from "react-icons/fa";
import clsx from "clsx";
import Tooltip from "@/components/Tooltip/Tooltip";

type Props = {
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
};

export default function ExperimentNameFormatTooltip({
  tipPosition = "top",
  className,
}: Props) {
  return (
    <Tooltip
      body={
        <>
          Enter only the <code>&lt;experiment_name&gt;</code> portion from the
          naming format{" "}
          <code>exp1:&lt;experiment_name&gt;:&lt;variant_name&gt;</code>. Do not
          include the <code>exp1:</code> prefix or the variation name.
        </>
      }
      className={clsx("text-muted d-inline-flex align-items-center", className)}
      style={{ cursor: "pointer" }}
      tipPosition={tipPosition}
    >
      <FaInfoCircle />
    </Tooltip>
  );
}
