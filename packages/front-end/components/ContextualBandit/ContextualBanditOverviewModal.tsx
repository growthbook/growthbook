import { contextualBanditEndpoints } from "shared/api-endpoints";
import { useForm } from "react-hook-form";
import { useLingui } from "@lingui/react/macro";
import { ApiContextualBanditInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
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
  const { t } = useLingui();
  const restApiCall = useRestApiCall();
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
      header={t`Edit Overview`}
      close={close}
      cta={t`Save`}
      submit={validatedSubmit(form, async (data) => {
        await restApiCall(contextualBanditEndpoints.updateContextualBandit, {
          params: { id: cb.id },
          body: {
            name: data.name.trim(),
            trackingKey: data.trackingKey,
            owner: data.owner,
          },
        });
        mutate();
      })}
    >
      <Field
        label={t`Name`}
        required
        minLength={2}
        {...form.register("name")}
      />
      <Field
        label={t`Tracking Key`}
        helpText={t`Unique identifier used to track impressions and analyze results`}
        {...form.register("trackingKey")}
      />
      <SelectOwner
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
    </ModalStandard>
  );
}
