import { useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectOwner from "@/components/Owner/SelectOwner";

export default function ContextualBanditOverviewModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      name: cb.name,
      trackingKey: cb.trackingKey,
      owner: cb.owner ?? "",
    },
  });

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-overview"
      header="Edit Overview"
      close={close}
      cta="Save"
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: data.name.trim(),
            trackingKey: data.trackingKey,
            owner: data.owner,
          }),
        });
        mutate();
      })}
    >
      <Field label="Name" required minLength={2} {...form.register("name")} />
      <Field
        label="Tracking Key"
        helpText="Unique identifier used to track impressions and analyze results"
        {...form.register("trackingKey")}
      />
      <div className="form-group">
        <label>Owner</label>
        <SelectOwner
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
      </div>
    </ModalStandard>
  );
}
