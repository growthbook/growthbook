import React, { FC, useMemo, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { ago, datetime } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Tooltip from "@/ui/Tooltip";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const LastUsed: FC<{ token: ApiKeyInterface }> = ({ token }) => {
  if (token.lastUsed) {
    return (
      <Tooltip
        content={
          token.disabled
            ? `${datetime(token.lastUsed)}. This is the last time a request was attempted, successful or not.`
            : datetime(token.lastUsed)
        }
      >
        <span>{ago(token.lastUsed)}</span>
      </Tooltip>
    );
  }
  if (token.lastUsed === null) {
    return <Text color="text-low">Never</Text>;
  }
  return (
    <Tooltip content="This token was created before usage tracking was added, so we don't know when it was last used.">
      <Text color="text-low">Unknown</Text>
    </Tooltip>
  );
};

// Admin view of every member's personal access token, so a compromised one can
// be revoked without waiting on its owner. Disable only — deleting a token and
// revealing its value both stay with the member who created it.
const MemberPersonalAccessTokens: FC = () => {
  const { apiCall } = useAuth();
  const { users } = useUser();
  const canManage = usePermissionsUtil().canDeleteApiKey();
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>(
    "/keys/personal-access-tokens",
    { shouldRun: () => canManage },
  );

  const tokens = useMemo(() => {
    const withOwner = (data?.keys ?? []).map((token) => ({
      token,
      owner: users.get(token.userId || ""),
    }));
    return withOwner.sort((a, b) =>
      (a.owner?.name || a.owner?.email || "").localeCompare(
        b.owner?.name || b.owner?.email || "",
      ),
    );
  }, [data?.keys, users]);

  if (!canManage) return null;

  const toggleDisabled = async (token: ApiKeyInterface) => {
    setError(null);
    try {
      await apiCall(`/keys/${token.id}/disabled`, {
        method: "PUT",
        body: JSON.stringify({ disabled: !token.disabled }),
      });
      await mutate();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="mt-4">
      <Heading as="h4" size="sm" mb="1">
        Member Tokens
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Revoke a member&apos;s token without removing them from your
        organization. Token values stay visible only to the member who created
        them.
      </Text>

      {tokens.length === 0 ? (
        <Text as="p" color="text-mid">
          No members have created personal access tokens.
        </Text>
      ) : (
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Member</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Last used</TableColumnHeader>
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map(({ token, owner }) => (
              <TableRow
                key={token.id}
                style={token.disabled ? { opacity: 0.55 } : undefined}
              >
                <TableCell>
                  {owner ? (
                    <>
                      <div>{owner.name || owner.email}</div>
                      {owner.name && (
                        <Text size="sm" color="text-low">
                          {owner.email}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Tooltip content="This member is no longer part of your organization, so the token no longer authenticates.">
                      <Text color="text-low">Former member</Text>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  {token.description || <Text color="text-low">—</Text>}
                  {token.disabled && (
                    <Badge ml="2" color="red" variant="soft" label="Disabled" />
                  )}
                </TableCell>
                <TableCell>
                  <LastUsed token={token} />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    color={token.disabled ? "violet" : "red"}
                    onClick={() => setPendingToggle(token)}
                  >
                    {token.disabled ? "Enable" : "Disable"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {error && (
        <Callout status="error" mt="2">
          {error}
        </Callout>
      )}

      {pendingToggle && (
        <ConfirmDialog
          title={
            pendingToggle.disabled
              ? "Enable personal access token?"
              : "Disable personal access token?"
          }
          content={
            pendingToggle.disabled
              ? "This token will immediately start accepting requests again."
              : "Any request using this token will be rejected until it is re-enabled. The member keeps their access to GrowthBook and can still delete or replace the token themselves."
          }
          yesText={pendingToggle.disabled ? "Enable" : "Disable"}
          onConfirm={async () => {
            await toggleDisabled(pendingToggle);
            setPendingToggle(null);
          }}
          onCancel={() => setPendingToggle(null)}
        />
      )}
    </div>
  );
};

export default MemberPersonalAccessTokens;
