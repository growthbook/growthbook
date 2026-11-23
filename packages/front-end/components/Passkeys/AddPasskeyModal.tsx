import { useForm } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnError,
  startRegistration,
} from "@simplewebauthn/browser";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";

function describeRegistrationError(e: unknown): string {
  if (e instanceof WebAuthnError) {
    if (e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return "This device already has a passkey for your account.";
    }
    if (e.code === "ERROR_INVALID_RP_ID" || e.code === "ERROR_INVALID_DOMAIN") {
      return "Passkeys aren't set up for this domain. Ask your admin to check WEBAUTHN_RP_ID.";
    }
  }
  return "Passkey setup was cancelled or didn't finish. Please try again.";
}

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
          throw new Error(describeRegistrationError(e));
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
          maxLength={64}
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
