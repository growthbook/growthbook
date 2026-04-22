import { useState, FC } from "react";
import { Flex } from "@radix-ui/themes";
import { Namespaces, NamespaceUsage } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import NamespaceModal from "@/components/Experiment/NamespaceModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import NamespaceTableRow from "@/components/Settings/NamespaceTableRow";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
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
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
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
        <Heading as="h1" size="x-large">
          Experiment Namespaces
        </Heading>
        {canCreate && (
          <Button onClick={() => setModalOpen(true)}>Add Namespace</Button>
        )}
      </Flex>
      <Text as="div" color="text-mid" mt="3" mb="6">
        Namespaces allow you to run mutually exclusive experiments.{" "}
        {namespaces.length > 0 &&
          "Click a namespace below to see more details about its current usage."}
      </Text>
      {namespaces.length > 0 && (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Namespace</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader justify="end">
                Active Experiments
              </TableColumnHeader>
              <TableColumnHeader justify="end">Available</TableColumnHeader>
              <TableColumnHeader style={{ width: 30 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {namespaces.map((ns) => {
              const experiments = data?.namespaces[ns.name] ?? [];
              return (
                <NamespaceTableRow
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
                      { method: "DELETE" },
                    );
                    await refreshOrganization();
                  }}
                  onArchive={async () => {
                    const newNamespace = {
                      label: ns.label || ns.name,
                      description: ns.description ?? "",
                      status: (ns?.status === "inactive"
                        ? "active"
                        : "inactive") as "active" | "inactive",
                      format: ns.format ?? "legacy",
                      ...(ns.format === "multiRange"
                        ? { hashAttribute: ns.hashAttribute }
                        : {}),
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
    </div>
  );
};
export default NamespacesPage;
