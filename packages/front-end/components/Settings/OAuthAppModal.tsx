import React, { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { OAuthAppInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import StringArrayField from "@/ui/StringArrayField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

export type OAuthApp = OAuthAppInterface & { authorizedUsers: number };

export type OAuthAppCredentials = { clientId: string; clientSecret: string };

export const DELEGATION_DESCRIPTION =
  "The app can use its client secret to get a short-lived token for any member who has authorized it, without storing refresh tokens. Anyone holding the secret can act as those members.";

export const OAuthAppModal: FC<{
  existing: OAuthApp | null;
  close: () => void;
  // Credentials come back on create only; the secret is never shown again.
  onSaved: (credentials: OAuthAppCredentials | null) => void;
}> = ({ existing, close, onSaved }) => {
  const { apiCall } = useAuth();
  const [clientName, setClientName] = useState(existing?.clientName ?? "");
  const [redirectUris, setRedirectUris] = useState<string[]>(
    existing?.redirectUris ?? [],
  );
  const [clientUri, setClientUri] = useState(existing?.clientUri ?? "");
  const [allowDelegation, setAllowDelegation] = useState(
    existing?.allowDelegation ?? false,
  );
  const [confirmingDelegationOff, setConfirmingDelegationOff] = useState(false);

  return (
    <>
      <ModalStandard
        trackingEventModalType=""
        open={true}
        header={existing ? "Edit OAuth App" : "New OAuth App"}
        cta={existing ? "Save" : "Create"}
        ctaEnabled={!!clientName.trim() && redirectUris.length > 0}
        close={close}
        submit={async () => {
          const body = JSON.stringify({
            clientName,
            redirectUris,
            clientUri,
            allowDelegation,
          });
          if (existing) {
            await apiCall(`/oauth-apps/${existing.clientId}`, {
              method: "PUT",
              body,
            });
            onSaved(null);
          } else {
            const res = await apiCall<{
              app: { clientId: string };
              clientSecret: string;
            }>("/oauth-apps", { method: "POST", body });
            onSaved({
              clientId: res.app.clientId,
              clientSecret: res.clientSecret,
            });
          }
        }}
      >
        <Flex direction="column" gap="4">
          <TextField
            label="Name"
            helpText="Shown to members on the authorization screen."
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Internal MCP server"
          />
          <StringArrayField
            label="Redirect URIs"
            helpText="Where authorization codes are sent. Must use https, except for localhost."
            value={redirectUris}
            onChange={setRedirectUris}
            delimiters={["Enter", "Tab", " "]}
            placeholder="https://mcp.example.com/oauth/callback"
          />
          <TextField
            label="Homepage URL (optional)"
            value={clientUri}
            onChange={(e) => setClientUri(e.target.value)}
            placeholder="https://mcp.example.com"
          />
          <Checkbox
            label="Allow acting on behalf of members"
            description={DELEGATION_DESCRIPTION}
            value={allowDelegation}
            setValue={(value) => {
              if (!value && existing?.allowDelegation) {
                setConfirmingDelegationOff(true);
              } else {
                setAllowDelegation(value);
              }
            }}
          />
        </Flex>
      </ModalStandard>
      {confirmingDelegationOff && (
        <ConfirmDialog
          title="Stop acting on behalf of members?"
          content="When you save, tokens this app got by acting on behalf of members stop working immediately. Members stay authorized, and tokens from their own sign-in keep working."
          yesText="Turn off"
          onConfirm={() => {
            setAllowDelegation(false);
            setConfirmingDelegationOff(false);
          }}
          onCancel={() => setConfirmingDelegationOff(false)}
        />
      )}
    </>
  );
};

export const ClientSecretModal: FC<
  OAuthAppCredentials & { close: () => void }
> = ({ clientId, clientSecret, close }) => (
  <ModalStandard
    trackingEventModalType=""
    open={true}
    header="Client Credentials"
    closeCta="Done"
    close={close}
  >
    <Callout status="warning" mb="4">
      Copy the client secret now. You won&apos;t be able to see it again.
    </Callout>
    <Flex direction="column" gap="4">
      <div>
        <Text as="div" weight="semibold" mb="1">
          Client ID
        </Text>
        <ClickToCopy>{clientId}</ClickToCopy>
      </div>
      <div>
        <Text as="div" weight="semibold" mb="1">
          Client secret
        </Text>
        <ClickToCopy>{clientSecret}</ClickToCopy>
      </div>
    </Flex>
  </ModalStandard>
);
