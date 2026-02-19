import {
  DashboardBlockInterfaceOrData,
  ProductAnalyticsExplorerBlockInterface,
} from "shared/enterprise";

interface Props {
  block: DashboardBlockInterfaceOrData<ProductAnalyticsExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ProductAnalyticsExplorerBlockInterface>
  >;
}
export default function ProductAnalyticsExplorerSettings({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  block,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setBlock,
}: Props) {
  return <div>Project Analytics Explorer Settings</div>;
}
