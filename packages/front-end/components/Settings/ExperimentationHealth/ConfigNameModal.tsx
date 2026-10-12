import React, { useState } from "react";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";

// Asks for a quality configuration's name (create, rename, save as new)
export default function ConfigNameModal({
  header,
  cta,
  initialName = "",
  note,
  close,
  submit,
}: {
  header: string;
  cta: string;
  initialName?: string;
  note?: string;
  close: () => void;
  submit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  return (
    <ModalStandard
      open
      trackingEventModalType="experiment-quality-config-name"
      header={header}
      cta={cta}
      ctaEnabled={!!name.trim()}
      close={close}
      submit={() => submit(name.trim())}
    >
      <Field
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Growth team standards"
        autoFocus
      />
      {note && (
        <Text size="sm" color="text-mid">
          {note}
        </Text>
      )}
    </ModalStandard>
  );
}
