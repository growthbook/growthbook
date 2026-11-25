import { useRef, useState } from "react";
import { PiArrowClockwise, PiCaretDownFill } from "react-icons/pi";
import type { SnapshotUpdateScopeKind } from "shared/types/experiment-snapshot";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  // Shared by both actions, so neither can start while the other's request is
  // in flight. The ref also catches a second click before the re-render.
  const pendingRef = useRef(false);
  const [pendingScope, setPendingScope] =
    useState<SnapshotUpdateScopeKind | null>(null);
  const runUpdate = async (
    scope: SnapshotUpdateScopeKind,
    update: () => Promise<void>,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingScope(scope);
    try {
      await update();
    } finally {
      pendingRef.current = false;
      setPendingScope(null);
    }
  };
  const pending = pendingScope !== null;

  return (
    <SplitButton
      variant="outline"
      menu={
        <DropdownMenu
          trigger={
            <Button
              variant="outline"
              size="md"
              aria-label={t`More update options`}
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
            onClick={() => void runUpdate("all_metrics", onUpdateAllMetrics)}
          >
            <Trans>Update all metrics</Trans>
          </DropdownMenuItem>
        </DropdownMenu>
      }
    >
      <Button
        variant="outline"
        size="md"
        icon={<PiArrowClockwise />}
        disabled={disabled || pending}
        loading={pendingScope === "new_metrics"}
        onClick={() => runUpdate("new_metrics", onUpdateNewMetrics)}
      >
        <Trans>Update new metrics</Trans>
      </Button>
    </SplitButton>
  );
}
