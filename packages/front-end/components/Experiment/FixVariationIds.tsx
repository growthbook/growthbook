import { useForm } from "react-hook-form";
import uniq from "lodash/uniq";
import SelectField from "@/components/Forms/SelectField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  setVariationIds: (ids: string[]) => Promise<void>;
  names: string[];
  expected: string[];
  actual: string[];
  close: () => void;
}

export default function FixVariationIds({
  names,
  expected,
  actual,
  setVariationIds,
  close,
}: Props) {
  const form = useForm({
    defaultValues: {
      ids: new Array(expected.length).fill(""),
    },
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      submit={form.handleSubmit(async (value) => {
        const ids = value.ids.map((id, i) => (id ? id : expected[i]));

        if (uniq(ids).length !== ids.length) {
          throw new Error("Variation Ids must all be unique");
        }

        await setVariationIds(ids);
      })}
      cta="Save"
      close={close}
      header="Fix Variation Ids"
    >
      <h3>Variation Ids</h3>
      {names.map((name, i) => (
        <SelectField
          size="legacy"
          key={i}
          label={name}
          options={actual.map((v) => ({ label: v, value: v }))}
          placeholder={expected[i]}
          value={form.watch(`ids.${i}`)}
          onChange={(value) => form.setValue(`ids.${i}`, value)}
        />
      ))}
    </ModalStandard>
  );
}
