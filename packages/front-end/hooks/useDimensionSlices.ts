import useApi from "./useApi";
import { DimensionSlicesInterface } from "back-end/types/dimension";


export function useDimensionSlices(datasourceId: string): DimensionSlicesInterface[] | undefined {
  const { data } = useApi<{
    dimensionSlices: DimensionSlicesInterface[];
  }>(`/dimension-slices/datasource/${datasourceId}`);

  return data?.dimensionSlices || [];
}