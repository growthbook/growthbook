import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function PickSegmentModal({
  close,
  save,
  segment,
  datasource,
}: {
  segment: string;
  datasource: string;
  close: () => void;
  save: (segment?: string) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      segment,
    },
  });

  const { segments } = useDefinitions();

  const segmentOptions = useMemo(() => {
    return segments
      .filter((s) => s.datasource === datasource)
      .map((s) => ({ label: s.name, value: s.id }));
  }, [segments]);

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header="Apply a Segment"
      submit={form.handleSubmit(async (data) => {
        await save(data.segment);
      })}
    >
      <SelectField
        size="legacy"
        label="Segment"
        options={segmentOptions}
        isClearable
        placeholder="None"
        value={form.watch("segment")}
        onChange={(value) => form.setValue("segment", value)}
      />
    </ModalStandard>
  );
}
