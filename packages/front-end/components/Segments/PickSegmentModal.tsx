import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import Modal from "../Modal";

export default function PickSegmentModal({
  close,
  save,
  objName,
  segment,
  datasource,
}: {
  segment: string;
  objName: string;
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
      .map((s) => {
        return {
          display: s.name,
          value: s.id,
        };
      });
  }, [segments]);

  return (
    <Modal
      open={true}
      close={close}
      header="Change Segment"
      submit={form.handleSubmit(async (data) => {
        await save(data.segment);
      })}
    >
      <p>Pick a segment to apply to this {objName}.</p>
      <Field
        label="Segment"
        options={segmentOptions}
        initialOption="None"
        {...form.register("segment")}
      />
    </Modal>
  );
}
