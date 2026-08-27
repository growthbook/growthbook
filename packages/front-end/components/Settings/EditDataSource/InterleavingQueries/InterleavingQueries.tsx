import React, { FC, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiInterleavingQueryInterface } from "shared/validators";
import { FaPencilAlt, FaPlus } from "react-icons/fa";
import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import AddEditInterleavingQueryModal from "@/components/Interleaving/AddEditInterleavingQueryModal";
import { useInterleavingQueries } from "@/hooks/useInterleavingQueries";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit: boolean;
};

/**
 * Datasource-page section for Interleaving exposure queries — the
 * interleaving-specific mirror of Experiment Assignment Queries. Queries live
 * in their own collection and return one row per impression x item.
 */
export const InterleavingQueries: FC<Props> = ({ dataSource, canEdit }) => {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { interleavingQueries, loading, error, mutate } =
    useInterleavingQueries(dataSource.id);

  const [modalState, setModalState] = useState<{
    mode: "add" | "edit";
    query?: ApiInterleavingQueryInterface;
  } | null>(null);

  const canManage =
    canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  return (
    <div>
      <Flex align="center" justify="between" mb="2">
        <Flex align="center" gap="2">
          <Heading as="h3" size="md" mb="0">
            Interleaving Exposure Queries
          </Heading>
          <Badge label="BETA" color="gray" variant="solid" />
        </Flex>
        {canManage && (
          <Button
            onClick={() => setModalState({ mode: "add" })}
            icon={<FaPlus />}
          >
            Add
          </Button>
        )}
      </Flex>
      <p className="text-muted">
        One row per impression and item from the SDK&apos;s interleave exposure
        events. Used to attribute engagement to the ranker that drafted each
        item.
      </p>

      {error ? (
        <Callout status="error">Failed to load interleaving queries.</Callout>
      ) : loading ? (
        <LoadingSpinner />
      ) : interleavingQueries.length === 0 ? (
        <Callout status="info">
          No interleaving exposure queries yet. Add one to start analyzing
          interleaving experiments against this Data Source.
        </Callout>
      ) : (
        <table className="table appbox gbtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Identifier type</th>
              <th>Analysis</th>
              {canManage && <th style={{ width: 100 }}></th>}
            </tr>
          </thead>
          <tbody>
            {interleavingQueries.map((q) => (
              <tr key={q.id}>
                <td>{q.name}</td>
                <td>{q.userIdType}</td>
                <td>
                  {q.hasInterleaveId ? (
                    <Badge label="Paired" color="green" />
                  ) : (
                    <Badge label="Ownership" color="violet" />
                  )}
                </td>
                {canManage && (
                  <td>
                    <Flex gap="3">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setModalState({ mode: "edit", query: q });
                        }}
                      >
                        <FaPencilAlt />
                      </a>
                      <DeleteButton
                        displayName={q.name}
                        useIcon={true}
                        deleteMessage={`Delete the interleaving query "${q.name}"?`}
                        title="Delete"
                        onClick={async () => {
                          await apiCall(
                            `/api/v1/interleaving-queries/${q.id}`,
                            {
                              method: "DELETE",
                            },
                          );
                          await mutate();
                        }}
                        link={true}
                      />
                    </Flex>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalState && (
        <AddEditInterleavingQueryModal
          mode={modalState.mode}
          interleavingQuery={modalState.query}
          dataSource={dataSource}
          onSave={async () => {
            await mutate();
            setModalState(null);
          }}
          onCancel={() => setModalState(null)}
        />
      )}
    </div>
  );
};

export default InterleavingQueries;
