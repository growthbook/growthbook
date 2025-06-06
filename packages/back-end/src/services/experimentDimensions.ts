import { ExperimentDimensionInterface } from "back-end/types/dimension";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { ReqContext } from "back-end/types/organization";

export async function getExperimentDimensionsByOrganization(context: ReqContext): Promise<ExperimentDimensionInterface[]> {
// get all exposure queries for the org
  const datasources = await getDataSourcesByOrganization(context);

  const dimensions: ExperimentDimensionInterface[] = [];
  datasources.forEach(ds => { 
    const exposureQueries = ds.settings?.queries?.exposure || [];
    exposureQueries.forEach(eq => {
      eq.dimensions.forEach((d, i) => {
        const dimensionMetadata = eq.dimensionMetadata?.find(md => md.dimension === d);
        dimensions.push({
          id: `${ds.id}-${eq.id}-${d}`,
          organization: context.org.id,
          exposureQueryId: eq.id,
          exposureQueryName: eq.name,
          datasourceId: ds.id,
          identifierType: eq.userIdType,
          dimensionValues: dimensionMetadata?.specifiedSlices?.flat(),
          dimensionSlicesId: eq.dimensionSlicesId,
          dimension: d,
          dimensionPriority: i, // priority controlled by order in EAQ array
          dimensionMetadata,
        })
    })
  });
});
console.log(dimensions);
return dimensions;
}