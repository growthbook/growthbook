import { useForm } from "react-hook-form";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useCelebrationLocalStorage } from "@/hooks/useCelebration";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";

// The Edit Profile modal, moved out of TopNav (name and the celebration
// setting, as before), opened from the profile menu's identity row. Change
// Password removed (set in review; it was here, moved from the profile
// menu).
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
    // The design system's standard modal (was the legacy Modal), with the
    // same header, fields and Save.
    <ModalStandard
      open={true}
      header="Edit Profile"
      close={close}
      submit={() => onSubmit()}
      trackingEventModalType=""
    >
      <Field label="Name" {...form.register("name")} />
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
