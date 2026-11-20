import { useForm } from "react-hook-form";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useCelebrationLocalStorage } from "@/hooks/useCelebration";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TextField from "@/ui/TextField";
import Checkbox from "@/ui/Checkbox";

export default function EditProfileModal({ close }: { close: () => void }) {
  const { updateUser, name } = useUser();
  const { apiCall } = useAuth();
  const [enableCelebrations, setEnableCelebrations] =
    useCelebrationLocalStorage();

  const form = useForm({
    defaultValues: { name: name || "", enableCelebrations },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    if (value.name !== name) {
      await apiCall(`/user/name`, {
        method: "PUT",
        body: JSON.stringify({ name: value.name }),
      });
      updateUser();
    }

    if (value.enableCelebrations !== enableCelebrations) {
      setEnableCelebrations(value.enableCelebrations);
    }
  });

  return (
    <ModalStandard
      open={true}
      header="Edit Profile"
      close={close}
      submit={() => onSubmit()}
      trackingEventModalType=""
    >
      <TextField label="Name" mb="4" {...form.register("name")} />
      <Checkbox
        id="allowCelebration"
        label="Allow celebration"
        description="Show confetti celebrations randomly when you complete certain actions like launching an experiment."
        value={form.watch("enableCelebrations")}
        setValue={(v) => form.setValue("enableCelebrations", v)}
      />
    </ModalStandard>
  );
}
