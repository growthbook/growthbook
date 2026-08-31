import React, { FC, useMemo, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { ago, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Tooltip from "@/ui/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
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
  const { users, settings } = useUser();
  const orgTokensDisabled = !!settings?.disablePersonalAccessTokens;
  const canManage = usePermissionsUtil().canDeleteApiKey();
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const {
    data,
    error: loadError,
    mutate,
  } = useApi<{ keys: ApiKeyInterface[] }>("/keys/personal-access-tokens", {
    shouldRun: () => canManage,
  });

  const rows = useMemo(
    () =>
      (data?.keys ?? []).map((token) => {
        const owner = users.get(token.userId || "");
        return {
          id: token.id || token.userId || "",
          memberName: owner?.name || "",
          memberEmail: owner?.email || "",
          description: token.description || "",
          // Sorted separately from display so "Never" and the pre-tracking
          // "Unknown" both land at the bottom instead of sorting as equal.
          lastUsedSort: token.lastUsed ? new Date(token.lastUsed).getTime() : 0,
          token,
        };
      }),
    [data?.keys, users],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: rows,
    localStorageKey: "memberPersonalAccessTokens",
    defaultSortField: "memberName",
    searchFields: ["memberName", "memberEmail", "description"],
    pageSize: 20,
  });

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
    <Frame mb="4">
      <Heading as="h3" size="md" mb="1">
        Member Tokens
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Disable a member&apos;s token without removing them from your
        organization. Token values stay visible only to the member who created
        them.
      </Text>

      {loadError ? (
        <Callout status="error">{loadError.message}</Callout>
      ) : !data ? (
        <Text as="p" color="text-mid">
          <LoadingSpinner /> Loading...
        </Text>
      ) : rows.length === 0 ? (
        <Text as="p" color="text-mid">
          No members have created personal access tokens.
        </Text>
      ) : (
        <>
          {orgTokensDisabled && (
            <Callout status="warning" mb="3">
              Personal access tokens are disabled for this organization, so none
              of these currently authenticate. Disabling one here still applies
              if that setting is turned back off.
            </Callout>
          )}
          <Flex align="center" gap="3" mb="2">
            <Text weight="medium">{`${rows.length} token${rows.length === 1 ? "" : "s"}`}</Text>
            <Box width="250px" flexShrink="0">
              <TextField
                type="search"
                placeholder="Search..."
                {...searchInputProps}
              />
            </Box>
          </Flex>
          <Table variant="surface">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="memberName">
                  Member
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="description">
                  Description
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="lastUsedSort">
                  Last used
                </SortableTableColumnHeader>
                <TableColumnHeader>
                  <span className="sr-only">Actions</span>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ id, memberName, memberEmail, token }) => {
                // Never dims the action cell — an admin still needs to read and
                // click it in exactly the states that dim everything else.
                const dimmed =
                  token.disabled || orgTokensDisabled
                    ? { opacity: 0.55 }
                    : undefined;
                return (
                  <TableRow key={id}>
                    <TableCell style={dimmed}>
                      {memberEmail ? (
                        <>
                          <div>{memberName || memberEmail}</div>
                          {memberName && (
                            <Text size="sm" color="text-low">
                              {memberEmail}
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
                      <span style={dimmed}>
                        {token.description || <Text color="text-low">—</Text>}
                      </span>
                      {token.disabled && (
                        <Badge
                          ml="2"
                          color="red"
                          variant="soft"
                          label="Disabled"
                        />
                      )}
                    </TableCell>
                    <TableCell style={dimmed}>
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
                );
              })}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={4} style={{ textAlign: "center" }}>
                    No matching tokens found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pagination}
        </>
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
    </Frame>
  );
};

export default MemberPersonalAccessTokens;
