import { CustomHookInterface } from "shared/validators";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Code from "@/components/SyntaxHighlighting/Code";

export default function CustomHookCodeModal({
  hook,
  close,
}: {
  hook: CustomHookInterface;
  close: () => void;
}) {
  return (
    <ModalStandard
      open
      header={hook.name}
      subheader={hook.hook}
      close={close}
      closeCta="Close"
      size="lg"
      trackingEventModalType=""
    >
      <Code language="javascript" code={hook.code} />
    </ModalStandard>
  );
}
