import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";

function Adornment({ children }: { children: ReactNode }) {
  return (
    <span
      onClick={(e) => {
        // Keep clicks on the help/adornment from toggling the parent control.
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ display: "inline-flex" }}
    >
      {children}
    </span>
  );
}

export default function LabelWithHelp({
  label,
  help,
  adornment,
}: {
  label: ReactNode;
  help?: string;
  adornment?: ReactNode;
}) {
  if (!help && !adornment) return <>{label}</>;
  return (
    <Flex align="center" gap="1" asChild>
      <span>
        {label}
        {help ? (
          <Adornment>
            <Tooltip body={help}>
              <PiInfo color="var(--color-text-low)" />
            </Tooltip>
          </Adornment>
        ) : null}
        {adornment ? <Adornment>{adornment}</Adornment> : null}
      </span>
    </Flex>
  );
}
