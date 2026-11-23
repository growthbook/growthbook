import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ago, date, datetime } from "shared/dates";
import type { PasskeySummary } from "shared/validators";
import { useAuth } from "@/services/auth";
import { usingSSO } from "@/services/env";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import RenamePasskeyModal from "@/components/Passkeys/RenamePasskeyModal";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Tooltip from "@/ui/Tooltip";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

export default function PasskeysPage() {
  return (
    <Box style={{ maxWidth: 800, margin: "0 auto" }}>
      {usingSSO() ? (
        <Callout status="info">
          You sign in with SSO, so passkeys are managed by your identity
          provider.
        </Callout>
      ) : (
        <Passkeys />
      )}
    </Box>
  );
}

function Passkeys() {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<{ passkeys: PasskeySummary[] }>(
    "/user/passkeys",
  );
  const [renaming, setRenaming] = useState<PasskeySummary | null>(null);
  const [removing, setRemoving] = useState<PasskeySummary | null>(null);

  return (
    <Flex direction="column" gap="4">
      <Heading as="h1" size="lg">
        Passkeys
      </Heading>
      <Text as="p">
        Sign in with your fingerprint, face, device PIN or security key instead
        of typing your password. Your password keeps working too.
      </Text>

      {error ? (
        <Callout status="error">{error.message}</Callout>
      ) : !data ? (
        <LoadingSpinner />
      ) : data.passkeys.length === 0 ? (
        <Text as="p" color="text-mid">
          You haven&apos;t added any passkeys yet.
        </Text>
      ) : (
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Added</TableColumnHeader>
              <TableColumnHeader>Last used</TableColumnHeader>
              <TableColumnHeader style={{ width: 180 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.passkeys.map((passkey) => (
              <TableRow key={passkey.id}>
                <TableCell>
                  {passkey.name}
                  {passkey.backedUp && (
                    <Tooltip content="Saved to a password manager that syncs it between your devices">
                      <Badge ml="2" variant="soft" label="Synced" />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>{date(passkey.dateCreated)}</TableCell>
                <TableCell>
                  {passkey.lastUsed ? (
                    <Tooltip content={datetime(passkey.lastUsed)}>
                      <span>{ago(passkey.lastUsed)}</span>
                    </Tooltip>
                  ) : (
                    <Text color="text-low">Never</Text>
                  )}
                </TableCell>
                <TableCell>
                  <Flex gap="2" justify="end">
                    <Button
                      variant="ghost"
                      onClick={() => setRenaming(passkey)}
                    >
                      Rename
                    </Button>
                    <Button
                      color="red"
                      variant="outline"
                      onClick={() => setRemoving(passkey)}
                    >
                      Remove
                    </Button>
                  </Flex>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {renaming && (
        <RenamePasskeyModal
          passkey={renaming}
          close={() => setRenaming(null)}
          onRenamed={mutate}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          content="You won't be able to sign in with this passkey anymore. You can also delete it from your device or password manager."
          yesText="Remove"
          color="red"
          onConfirm={async () => {
            await apiCall(`/user/passkeys/${removing.id}`, {
              method: "DELETE",
            });
            setRemoving(null);
            mutate();
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Flex>
  );
}
