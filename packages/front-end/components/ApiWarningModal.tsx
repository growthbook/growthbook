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
  return (
    <ModalStandard
      open={true}
      header="Warnings"
      cta="Save anyway"
      trackingEventModalType="api-warning"
      submit={async () => {
        onConfirm();
      }}
      close={onCancel}
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
