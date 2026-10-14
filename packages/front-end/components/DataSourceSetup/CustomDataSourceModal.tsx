import { useState } from "react";
import { useRouter } from "next/router";
import { DataSourceType } from "shared/types/datasource";
import { isTestableDataSourceType } from "shared/validators";
import { dataSourceConnections } from "@/services/eventSchema";
import Avatar from "@/ui/Avatar";
import Heading from "@/ui/Heading";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";
import { DATA_SOURCE_TYPE_AVATAR } from "./dataSourceTypeAvatar";

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
      cta="Continue to connect"
      ctaEnabled={!!type}
      submit={continueToConnect}
      close={close}
      size="lg"
      trackingEventModalType="custom-data-source-setup"
      trackingEventModalSource={source}
    >
      <Text as="p" color="text-mid" mb="4">
        GrowthBook connects with read access and queries your data with SQL you
        define.
      </Text>
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
            <Avatar
              size="sm"
              variant="soft"
              radius="small"
              color={DATA_SOURCE_TYPE_AVATAR[connection.type].color}
            >
              {DATA_SOURCE_TYPE_AVATAR[connection.type].abbr}
            </Avatar>
          ),
        }))}
      />
    </ModalStandard>
  );
}
