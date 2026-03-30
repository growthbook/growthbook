import { useState, FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Namespaces, NamespaceUsage } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import NamespaceModal from "@/components/Experiment/NamespaceModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import NamespaceTableRow from "@/components/Settings/NamespaceTableRow";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
} from "@/ui/Table";

export type NamespaceApiResponse = {
  namespaces: NamespaceUsage;
};

const NamespacesPage: FC = () => {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`,
  );

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateNamespace();

  const { refreshOrganization } = useUser();
  const { namespaces = [] } = useOrgSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [editNamespace, setEditNamespace] = useState<{
    namespace: Namespaces;
    experiments: number;
  } | null>(null);
  const { apiCall } = useAuth();

  if (error) {
    return (
      <Callout status="error" mb="3">
        An error occurred: {error.message}
      </Callout>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <Box className="pagecontents">
      {modalOpen && (
        <NamespaceModal
          existing={editNamespace}
          close={() => {
            setModalOpen(false);
            setEditNamespace(null);
          }}
          onSuccess={() => {
            refreshOrganization();
            setEditNamespace(null);
          }}
        />
      )}
      <Flex align="center" justify="between" mb="1">
        <h1 style={{ margin: 0 }}>Experiment Namespaces</h1>
        {canCreate ? (
          <Button onClick={() => setModalOpen(true)}>Add Namespace</Button>
        ) : null}
      </Flex>
      <Box mb="3" style={{ color: "var(--gray-11)" }}>
        <p style={{ margin: 0 }}>
          Namespaces allow you to run mutually exclusive experiments.{" "}
          {namespaces.length > 0 &&
            "Click a namespace below to see more details about its current usage."}
        </p>
      </Box>
      {namespaces.length > 0 && (
        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Namespace</TableColumnHeader>
              <TableColumnHeader>
                Namespace ID{" "}
                <Tooltip body="This id is used as the namespace hash key and cannot be changed" />
              </TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Active experiments</TableColumnHeader>
              <TableColumnHeader>Percent available</TableColumnHeader>
              <TableColumnHeader style={{ width: 30 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {namespaces.map((ns, i) => {
              const experiments = data?.namespaces[ns.name] ?? [];
              return (
                <NamespaceTableRow
                  i={i}
                  key={ns.name}
                  usage={data.namespaces}
                  namespace={ns}
                  onEdit={() => {
                    setEditNamespace({
                      namespace: ns,
                      experiments: experiments.length,
                    });
                    setModalOpen(true);
                  }}
                  onDelete={async () => {
                    await apiCall(
                      `/organization/namespaces/${encodeURIComponent(ns.name)}`,
                      {
                        method: "DELETE",
                      },
                    );
                    await refreshOrganization();
                  }}
                  onArchive={async () => {
                    const newNamespace = {
                      name: ns.name,
                      description: ns.description,
                      status: ns?.status === "inactive" ? "active" : "inactive",
                    };
                    await apiCall(
                      `/organization/namespaces/${encodeURIComponent(ns.name)}`,
                      {
                        method: "PUT",
                        body: JSON.stringify(newNamespace),
                      },
                    );
                    await refreshOrganization();
                  }}
                />
              );
            })}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};
export default NamespacesPage;
