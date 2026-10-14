import { useState } from "react";
import { useRouter } from "next/router";
import { DataSourceType } from "shared/types/datasource";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import Heading from "@/ui/Heading";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

export default function CustomDataSourceModal({
  close,
  source,
}: {
  close: () => void;
  source: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<DataSourceType | "">("");

  const continueToConnect = async () => {
    if (!type) return;
    const params = new URLSearchParams({ type, setup: "custom" });
    await router.push(`/datasources/new/connect?${params.toString()}`);
  };

  return (
    <ModalStandard
      open={true}
      header="Set Up Custom Data Source"
      cta="Continue to connect"
      ctaEnabled={!!type}
      submit={continueToConnect}
      close={close}
      size="xl"
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
      <DataSourceTypeSelector value={type} setValue={setType} columns="2" />
    </ModalStandard>
  );
}
