import React, { FC, useState } from "react";
import { ago, datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

export type OrgOAuthGrant = {
  clientId: string;
  clientName: string;
  isOrgApp: boolean;
  userId: string;
  userName: string;
  userEmail: string;
  firstAuthorizedAt: string;
  lastUsedAt: string;
};

// Every member's live OAuth authorization in the org, across all applications.
const OAuthGrantsTable: FC<{
  grants: OrgOAuthGrant[];
  canRevoke: boolean;
  onRevoked: () => void;
}> = ({ grants, canRevoke, onRevoked }) => {
  const { apiCall } = useAuth();
  const [pendingRevoke, setPendingRevoke] = useState<OrgOAuthGrant | null>(
    null,
  );

  return (
    <>
      <Heading as="h4" size="sm" mt="5" mb="2">
        Member Authorizations
      </Heading>
      {grants.length === 0 ? (
        <Text as="p" color="text-mid">
          No members have authorized an OAuth application yet.
        </Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Member</TableColumnHeader>
              <TableColumnHeader>Application</TableColumnHeader>
              <TableColumnHeader>First authorized</TableColumnHeader>
              <TableColumnHeader>Last used</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={`${grant.clientId}:${grant.userId}`}>
                <TableCell>
                  <Text as="div">{grant.userName || grant.userEmail}</Text>
                  {grant.userName && (
                    <Text as="div" size="sm" color="text-low">
                      {grant.userEmail}
                    </Text>
                  )}
                </TableCell>
                <TableCell>
                  {grant.clientName}
                  {grant.isOrgApp && (
                    <Badge ml="2" variant="soft" label="Org app" />
                  )}
                </TableCell>
                <TableCell>{datetime(grant.firstAuthorizedAt)}</TableCell>
                <TableCell>
                  <Tooltip content={datetime(grant.lastUsedAt)}>
                    <span>{ago(grant.lastUsedAt)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {canRevoke && (
                    <Button
                      color="red"
                      variant="outline"
                      onClick={() => setPendingRevoke(grant)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pendingRevoke && (
        <ConfirmDialog
          title={`Revoke ${pendingRevoke.clientName} for ${pendingRevoke.userEmail}?`}
          content="The app is signed out for this member and its tokens stop working immediately. The member can authorize it again unless your OAuth access setting blocks it."
          yesText="Revoke"
          onConfirm={async () => {
            await apiCall("/oauth-apps/grants/revoke", {
              method: "POST",
              body: JSON.stringify({
                clientId: pendingRevoke.clientId,
                userId: pendingRevoke.userId,
              }),
            });
            setPendingRevoke(null);
            onRevoked();
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </>
  );
};

export default OAuthGrantsTable;
