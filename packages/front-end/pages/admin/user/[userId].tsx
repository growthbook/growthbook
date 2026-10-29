import { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import { hasSuperAdminPermission } from "shared/permissions";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import CopyableCode from "@/components/Settings/CopyableCode";
import EditMember, {
  AdminMember,
  formatSuperAdmin,
} from "@/components/Admin/EditMember";
import KeyValues from "@/components/Admin/KeyValues";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";

type UserDetailResponse = {
  user: AdminMember;
  organizations: {
    id: string;
    name: string;
    role?: string;
    lastLoginDate?: string;
  }[];
};

export default function AdminUserPage() {
  const router = useRouter();
  const userId = router.query.userId as string | undefined;
  const { superAdmin, license } = useUser();
  const canView = hasSuperAdminPermission(superAdmin, "view");
  const canEdit =
    hasSuperAdminPermission(superAdmin, "users") ||
    hasSuperAdminPermission(superAdmin, "grant");
  const [editOpen, setEditOpen] = useState(false);

  const { data, error, mutate } = useApi<UserDetailResponse>(
    `/admin/user/${userId}`,
    { shouldRun: () => canView && !!userId },
  );

  if (!canView) {
    return (
      <Callout status="error">Only super admins can view this page</Callout>
    );
  }
  if (!isCloud() && license?.plan !== "enterprise") {
    return (
      <Callout status="error">
        You must be on an enterprise license to view this page
      </Callout>
    );
  }
  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { user, organizations } = data;

  return (
    <Box className="pagecontents" p="3">
      <PageHead
        breadcrumb={[
          { display: "Admin", href: "/admin#members" },
          { display: user.name || user.email },
        ]}
      />
      {editOpen && (
        <EditMember
          member={user}
          onEdit={() => mutate()}
          close={() => setEditOpen(false)}
        />
      )}

      <Flex justify="between" align="start" gap="4" wrap="wrap" mb="4">
        <Flex direction="column" gap="1" minWidth="0">
          <Heading as="h1" size="xl" mb="0" overflowWrap="anywhere">
            {user.name || user.email}
          </Heading>
          <Flex gap="4" wrap="wrap" align="center">
            <CopyableCode value={user.id} muted />
            {user.dateCreated && (
              <Text color="text-mid" size="sm">
                Created {date(user.dateCreated)}
              </Text>
            )}
          </Flex>
        </Flex>
        {canEdit && (
          <Button onClick={() => setEditOpen(true)}>Edit user</Button>
        )}
      </Flex>

      <Flex gap="4" wrap="wrap" align="start">
        <Flex direction="column" flexGrow="999" flexBasis="640px" minWidth="0">
          <Frame px="0" pt="4" pb="0">
            <Box px="5" mb="3">
              <Heading as="h2" size="md" mb="0">
                Organizations
              </Heading>
            </Box>
            <Table variant="list" stickyHeader scrollX>
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>ID</TableColumnHeader>
                  <TableColumnHeader>Role</TableColumnHeader>
                  <TableColumnHeader>Last login</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Text color="text-mid">
                        Not a member of any organization
                      </Text>
                    </TableCell>
                  </TableRow>
                ) : (
                  organizations.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell style={{ overflowWrap: "anywhere" }}>
                        <Link href={`/admin/org/${o.id}`}>{o.name}</Link>
                      </TableCell>
                      <TableCell>
                        <code>{o.id}</code>
                      </TableCell>
                      <TableCell>{o.role ?? "-"}</TableCell>
                      <TableCell>
                        {o.lastLoginDate ? date(o.lastLoginDate) : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Frame>
        </Flex>

        <Flex direction="column" flexGrow="1" flexBasis="360px" minWidth="0">
          <Frame py="4" px="5">
            <Heading as="h2" size="md" mb="3">
              Account
            </Heading>
            <KeyValues
              items={[
                {
                  label: "Email",
                  value: (
                    <Flex align="center" gap="2" wrap="wrap">
                      {user.email}
                      <Badge
                        label={user.verified ? "Verified" : "Unverified"}
                        color={user.verified ? "green" : "amber"}
                      />
                    </Flex>
                  ),
                },
                {
                  label: "Super admin",
                  value: formatSuperAdmin(user.superAdmin),
                },
                {
                  label: "Sign-in identity",
                  value: user.authSubject ? (
                    <CopyableCode value={user.authSubject} muted />
                  ) : (
                    "Not bound"
                  ),
                },
              ]}
            />
          </Frame>
        </Flex>
      </Flex>
    </Box>
  );
}
