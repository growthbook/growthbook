import { UpdateProps } from "shared/types/base-model";
import { SavedQuery, savedQueryValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: savedQueryValidator,
  collectionName: "savedqueries",
  idPrefix: "sq_",
  auditLog: {
    entity: "savedQuery",
    createEvent: "savedQuery.create",
    updateEvent: "savedQuery.update",
    deleteEvent: "savedQuery.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class SavedQueryDataModel extends BaseClass {
  protected migrate(legacyDoc: unknown): SavedQuery {
    const doc = legacyDoc as SavedQuery;

    // Migrate anchorYAxisToZero for line and scatter charts
    if (doc.dataVizConfig && Array.isArray(doc.dataVizConfig)) {
      const chartTypesWithAnchorYAxisToZero = ["line", "scatter"];

      doc.dataVizConfig = doc.dataVizConfig.map((config) => {
        const chartType = config.chartType;

        // Only handle line and scatter charts
        if (!chartTypesWithAnchorYAxisToZero.includes(chartType)) {
          return config;
        }

        const configWithDisplaySettings = config as typeof config & {
          displaySettings?: {
            anchorYAxisToZero?: boolean;
          };
        };
        const displaySettings = configWithDisplaySettings.displaySettings;

        // Ensure anchorYAxisToZero exists (default to true)
        if (!displaySettings || !("anchorYAxisToZero" in displaySettings)) {
          return {
            ...config,
            displaySettings: {
              ...(displaySettings || {}),
              anchorYAxisToZero: true,
            },
          } as typeof config;
        }

        return config;
      });
    }

    return doc;
  }

  protected canRead(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canViewSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canCreate(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) {
      throw new Error("Datasource not found");
    }
    return this.context.permissions.canRunSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(
    existing: SavedQuery,
    updates: UpdateProps<SavedQuery>,
  ): boolean {
    // Always get the datasource from the existing object
    const { datasource: existingDatasource } = this.getForeignRefs(existing);
    if (!existingDatasource) {
      throw new Error("Existing datasource not found");
    }

    // Get the datasource from the combined object
    const { datasource: newDatasource = existingDatasource } =
      this.getForeignRefs({
        ...existing,
        ...updates,
      });

    if (!newDatasource) {
      throw new Error("New datasource not found");
    }

    return this.context.permissions.canUpdateSqlExplorerQueries(
      {
        projects: existingDatasource.projects || [],
      },
      {
        projects: newDatasource.projects || [],
      },
    );
  }
  protected canDelete(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canDeleteSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
}
