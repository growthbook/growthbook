import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";

export const CLICKHOUSE_CLUSTER_CONFIGURATION_ERROR_CODE =
  "clickhouse_cluster_configuration";

export class ClickHouseClusterConfigurationError extends Error {
  status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ClickHouseClusterConfigurationError";
  }
}

function isClickHouseCloud(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url.match(/^https?:/) ? url : `https://${url}`);
    return parsed.hostname.endsWith(".clickhouse.cloud");
  } catch {
    return false;
  }
}

export function getClickHouseCluster(
  params: Pick<ClickHouseConnectionParams, "cluster" | "url">,
  isManagedWarehouse: boolean,
): string | null {
  const configuredCluster = params.cluster?.trim();
  if (configuredCluster) return configuredCluster;

  // ClickHouse Cloud exposes the `default` cluster for the current service.
  // GrowthBook's managed warehouse has the same topology.
  if (isManagedWarehouse || isClickHouseCloud(params.url)) return "default";

  return null;
}

export function getClickHouseOnClusterClause(cluster: string | null): string {
  if (!cluster) return "";

  // Cluster names are identifiers, not values, so they cannot use a query
  // parameter. Permit the identifier characters ClickHouse uses in names such
  // as `all_groups.default`, and quote the identifier in the generated SQL.
  if (!/^[a-zA-Z0-9_.-]+$/.test(cluster)) {
    throw new ClickHouseClusterConfigurationError(
      "The ClickHouse cluster name is invalid. Update this Data Source's cluster configuration and try again.",
    );
  }

  return ` ON CLUSTER \`${cluster}\``;
}

export function assertClickHouseQueryWasCancelled(
  killStatuses: Array<{ kill_status?: string }>,
  cluster: string | null,
): void {
  if (!killStatuses.length && !cluster) {
    throw new ClickHouseClusterConfigurationError(
      "GrowthBook could not find this ClickHouse query on the connected node. If this Data Source uses multiple replicas, configure its ClickHouse cluster name and try again. The query may have already completed.",
    );
  }

  const incompleteStatuses = killStatuses
    .map((status) => status.kill_status)
    .filter((status): status is string => status !== undefined)
    .filter((status) => status !== "finished");

  if (incompleteStatuses.length) {
    throw new Error(
      `ClickHouse could not confirm that the query was cancelled: ${incompleteStatuses.join(", ")}`,
    );
  }
}
