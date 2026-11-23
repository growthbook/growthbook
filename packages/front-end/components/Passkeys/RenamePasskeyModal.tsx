import { useForm } from "react-hook-form";
import type { PasskeySummary } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import TextField from "@/ui/TextField";

export default function RenamePasskeyModal({
  passkey,
  close,
  onRenamed,
}: {
  passkey: PasskeySummary;
  close: () => void;
  onRenamed: () => void;
}) {
  const { apiCall } = useAuth();
  const form = useForm({ defaultValues: { name: passkey.name } });

  return (
    <ModalStandard
      open={true}
      trackingEventModalType=""
      header="Rename Passkey"
      close={close}
      submit={validatedSubmit(form, async ({ name }) => {
        await apiCall(`/user/passkeys/${passkey.id}`, {
          method: "PUT",
          body: JSON.stringify({ name }),
        });
        onRenamed();
      })}
    >
      <TextField
        label="Name"
        required
        maxLength={64}
        {...form.register("name", { required: true })}
      />
    </ModalStandard>
  );
}
