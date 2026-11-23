import { useForm } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { PASSKEY_NAME_MAX_LENGTH } from "shared/validators";
import {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  startRegistration,
} from "@simplewebauthn/browser";
import { useAuth } from "@/services/auth";
import { describeWebAuthnError } from "@/services/passkeys";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";

export default function AddPasskeyModal({
  close,
  onAdded,
}: {
  close: () => void;
  onAdded: () => void;
}) {
  const { apiCall } = useAuth();
  const form = useForm({ defaultValues: { name: "", password: "" } });

  return (
    <ModalStandard
      open={true}
      trackingEventModalType=""
      header="Add Passkey"
      cta="Continue"
      close={close}
      submit={validatedSubmit(form, async ({ name, password }) => {
        const { options } = await apiCall<{
          options: PublicKeyCredentialCreationOptionsJSON;
        }>("/user/passkeys/register/options", {
          method: "POST",
          body: JSON.stringify({ password }),
        });

        let response: RegistrationResponseJSON;
        try {
          response = await startRegistration({ optionsJSON: options });
        } catch (e) {
          throw new Error(
            describeWebAuthnError(e) ??
              "Passkey setup was cancelled or didn't finish. Please try again.",
          );
        }

        await apiCall("/user/passkeys/register/verify", {
          method: "POST",
          body: JSON.stringify({ name, response }),
        });
        onAdded();
      })}
    >
      <Flex direction="column" gap="4">
        <Text as="p">
          After you continue, your browser will ask you to create the passkey.
        </Text>
        <TextField
          label="Name"
          placeholder="Work laptop"
          helpText="So you can tell your passkeys apart"
          required
          maxLength={PASSKEY_NAME_MAX_LENGTH}
          {...form.register("name", { required: true })}
        />
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          {...form.register("password", { required: true })}
        />
      </Flex>
    </ModalStandard>
  );
}
