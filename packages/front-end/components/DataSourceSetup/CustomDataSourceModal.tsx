import { useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import { DataSourceType } from "shared/types/datasource";
import { isTestableDataSourceType } from "shared/validators";
import { dataSourceConnections } from "@/services/eventSchema";
import Heading from "@/ui/Heading";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";

// The connect page only handles warehouses with credentials to test, and
// Mixpanel is deprecated for new connections.
const warehouses = dataSourceConnections.filter(
  (connection) =>
    isTestableDataSourceType(connection.type) && connection.type !== "mixpanel",
);

export default function CustomDataSourceModal({
  close,
  source,
}: {
  close: () => void;
  source: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<DataSourceType | null>(null);

  const continueToConnect = async () => {
    if (!type) return;
    const params = new URLSearchParams({ type, setup: "custom" });
    await router.push(`/datasources/new/connect?${params.toString()}`);
  };

  return (
    <ModalStandard
      open={true}
      header="Connect Your Warehouse"
      subheader="GrowthBook connects with read access and queries your data with SQL you define."
      cta="Continue to connect"
      ctaEnabled={!!type}
      submit={continueToConnect}
      close={close}
      size="lg"
      trackingEventModalType="custom-data-source-setup"
      trackingEventModalSource={source}
    >
      <Heading as="h3" size="sm" mb="3">
        Choose Your Warehouse
      </Heading>
      <RadioCards
        columns="3"
        width="100%"
        align="center"
        labelSize="md"
        labelWeight="medium"
        value={type ?? ""}
        setValue={(value) => setType(value as DataSourceType)}
        options={warehouses.map((connection) => ({
          value: connection.type,
          label: connection.display,
          avatar: (
            <Flex align="center" flexShrink="0" style={{ fontSize: 28 }}>
              {connection.icon}
            </Flex>
          ),
        }))}
      />
    </ModalStandard>
  );
}
