import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { usingSSO } from "@/services/env";
import { useCelebrationLocalStorage } from "@/hooks/useCelebration";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// The Edit Profile modal, moved out of TopNav (name and the celebration
// setting, as before), opened from the profile menu's identity row. Change
// Password moved here from the profile menu (app header redesign), for
// accounts that don't sign in with SSO, as before.
export default function EditProfileModal({
  close,
  openChangePassword,
}: {
  close: () => void;
  openChangePassword: () => void;
}) {
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
      {!usingSSO() ? (
        <Box mt="4">
          <Text as="div" weight="medium" mb="2">
            Password
          </Text>
          {/* Closes this modal and opens Change Password in its place. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              close();
              openChangePassword();
            }}
          >
            Change Password
          </Button>
        </Box>
      ) : null}
    </ModalStandard>
  );
}
