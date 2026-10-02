import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { DataRegion } from "@/services/dataRegions";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import track from "@/services/track";

// Creates the Managed Warehouse, then seeds its starter fact tables and metrics.
export function useCreateManagedWarehouse() {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const createResources = async (datasource: DataSourceInterfaceWithParams) => {
    const resources = getInitialDatasourceResources({
      datasource,
      attributeSchema: settings.attributeSchema,
    });
    if (!resources.factTables.length) return;

    try {
      await createInitialResources({
        datasource,
        apiCall,
        metricDefaults,
        settings,
        resources,
      });
      track("Creating Datasource Resources", {
        source: "managed-warehouse",
        type: datasource.type,
        schema: datasource.settings?.schemaFormat,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Returns the new datasource id.
  return async (region: DataRegion) => {
    const res = await apiCall<{
      status: number;
      id: string;
      datasource: DataSourceInterfaceWithParams;
    }>("/datasources/managed-warehouse", {
      method: "POST",
      body: JSON.stringify({ region }),
    });
    if (!res.id) {
      throw new Error("Error creating managed warehouse");
    }

    await createResources(res.datasource);
    await mutateDefinitions();
    return res.id;
  };
}
