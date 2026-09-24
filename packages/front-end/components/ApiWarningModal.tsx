import { useRef } from "react";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import WarningText from "@/components/WarningText";

// Global dialog for API soft warnings (HTTP 422) — acknowledge to proceed, or cancel.
export default function ApiWarningModal({
  warnings,
  hookWarnings,
  onConfirm,
  onCancel,
}: {
  warnings: string[];
  hookWarnings: Set<string>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // ModalStandard fires submit then close on confirm; report exactly one outcome.
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
            {hookWarnings.has(warning) ? (
              <WarningText text={warning} />
            ) : (
              warning
            )}
          </Callout>
        ))}
      </Flex>
    </ModalStandard>
  );
}
