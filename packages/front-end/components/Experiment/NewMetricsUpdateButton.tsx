import { useRef, useState } from "react";
import { PiArrowClockwise, PiCaretDownFill } from "react-icons/pi";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SplitButton from "@/ui/SplitButton";

export default function NewMetricsUpdateButton({
  onUpdateNewMetrics,
  onUpdateAllMetrics,
  disabled,
}: {
  onUpdateNewMetrics: () => Promise<void>;
  onUpdateAllMetrics: () => Promise<void>;
  disabled: boolean;
}) {
  // Shared by both actions, so neither can start while the other's request is
  // in flight. The ref also catches a second click before the re-render.
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const runUpdate = async (update: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await update();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <SplitButton
      variant="outline"
      menu={
        <DropdownMenu
          trigger={
            <Button
              variant="outline"
              size="md"
              aria-label="More update options"
              disabled={disabled || pending}
            >
              <PiCaretDownFill />
            </Button>
          }
          menuPlacement="end"
          variant="soft"
        >
          {/* Not awaited: the update can open a dialog, and the menu would
              stay open behind it until the update finished. */}
          <DropdownMenuItem
            disabled={pending}
            onClick={() => void runUpdate(onUpdateAllMetrics)}
          >
            Update all metrics
          </DropdownMenuItem>
        </DropdownMenu>
      }
    >
      <Button
        variant="outline"
        size="md"
        icon={<PiArrowClockwise />}
        disabled={disabled || pending}
        loading={pending}
        onClick={() => runUpdate(onUpdateNewMetrics)}
      >
        Update new metrics
      </Button>
    </SplitButton>
  );
}
