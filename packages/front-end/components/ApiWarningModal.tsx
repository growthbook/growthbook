import { useRef } from "react";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";

// Global dialog shown when an API request returns soft warnings (HTTP 422).
// The user can acknowledge them and proceed, or cancel. Generic on purpose so
// it can surface warnings from any feature, not just custom hooks.
export default function ApiWarningModal({
  warnings,
  onConfirm,
  onCancel,
}: {
  warnings: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // ModalStandard fires `submit` AND then `close` when the user confirms
  // Report exactly one outcome to the caller — whichever fires first wins.
  const reported = useRef(false);
  const reportOnce = (report: () => void) => {
    if (reported.current) return;
    reported.current = true;
    report();
  };

  return (
    <ModalStandard
      open={true}
      header="Warning"
      cta="Save anyway"
      trackingEventModalType="api-warning"
      submit={async () => reportOnce(onConfirm)}
      close={() => reportOnce(onCancel)}
      ctaColor="red"
    >
      <Flex direction="column" gap="3">
        {warnings.map((warning, i) => (
          <Callout key={i} status="warning">
            {warning}
          </Callout>
        ))}
      </Flex>
    </ModalStandard>
  );
}
