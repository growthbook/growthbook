import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
}

export default function DataVisualizationSettings({ block, setBlock }: Props) {
  return <div>Hello from DataVisualizationSettings</div>;
}
