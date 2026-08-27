import React, { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import InterleavingForm from "@/components/Interleaving/InterleavingForm";
import { useInterleavings } from "@/hooks/useInterleavings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const STATUS_COLORS = {
  draft: "gray",
  running: "indigo",
  stopped: "gray",
} as const;

export default function InterleavingListPage() {
  const router = useRouter();
  const { hasCommercialFeature } = useUser();
  const { project, projects, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { interleavings, loading, error, mutate } = useInterleavings(project);
  const [showForm, setShowForm] = useState(false);

  if (!hasCommercialFeature("interleaving")) {
    return (
      <div className="container pagecontents">
        <PremiumEmptyState
          h1="Interleaving"
          title="Compare rankers with interleaved lists"
          description="Interleaving experiments blend two rankers' results into one list per impression and credit engagement to the drafting ranker — a far more sensitive way to compare ranking models."
          commercialFeature="interleaving"
          learnMoreLink="https://docs.growthbook.io/interleaving/overview"
        />
      </div>
    );
  }

  const canCreate = permissionsUtil.canViewInterleavingModal(project, projects);

  return (
    <div className="container pagecontents">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h1" size="xl" mb="0">
            Interleaving
          </Heading>
          <Badge label="Beta" color="indigo" variant="solid" />
        </Flex>
        {canCreate && (
          <Button onClick={() => setShowForm(true)}>
            Add interleaving experiment
          </Button>
        )}
      </Flex>

      {error ? (
        <Callout status="error">
          Failed to load interleaving experiments.
        </Callout>
      ) : loading ? (
        <LoadingSpinner />
      ) : interleavings.length === 0 ? (
        <Callout status="info">
          No interleaving experiments yet. Set up an interleaving exposure query
          on your Data Source, then add your first experiment.
        </Callout>
      ) : (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Data Source</th>
              <th>Metrics</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {interleavings.map((il) => (
              <tr
                key={il.id}
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/interleaving/${il.id}`)}
              >
                <td>{il.name}</td>
                <td>
                  <Badge
                    label={il.status}
                    color={STATUS_COLORS[il.status] ?? "gray"}
                  />
                </td>
                <td>
                  {getDatasourceById(il.datasource)?.name ?? il.datasource}
                </td>
                <td>{il.metricIds.length}</td>
                <td>{date(il.dateUpdated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Box mt="3" />

      {showForm && (
        <InterleavingForm
          mode="add"
          onSave={async (il) => {
            await mutate();
            setShowForm(false);
            router.push(`/interleaving/${il.id}`);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
