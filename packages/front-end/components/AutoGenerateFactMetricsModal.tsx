import { useState } from "react";
import { AutoFactMetricToCreate } from "back-end/src/types/Integration";
import { useAuth } from "@/services/auth";
import Modal from "./Modal";
import Button from "./Button";

type Props = {
  setShowAutoGenerateFactMetricsModal: (show: boolean) => void;
  factTableId: string;
};

export default function AutoGenerateFactMetricsModal({
  setShowAutoGenerateFactMetricsModal,
  factTableId,
}: Props) {
  const [autoFactMetricsToCreate, setAutoFactMetricsToCreate] = useState<
    AutoFactMetricToCreate[]
  >([]);
  const { apiCall } = useAuth();
  return (
    <Modal
      size="lg"
      open={true}
      header="Discover Fact Metrics"
      close={() => setShowAutoGenerateFactMetricsModal(false)}
      submit={async () => {
        try {
          const res = await apiCall(
            `/fact-tables/auto-metrics/${factTableId}`,
            {
              method: "POST",
              body: JSON.stringify({ autoFactMetricsToCreate }),
            }
          );
          console.log({ res });
        } catch (e) {
          console.log(e);
        }
      }}
      cta={"Generate Fact Metrics"}
    >
      <>
        <h1>Hi</h1>
        <Button
          onClick={async () => {
            try {
              const res = await apiCall<{
                autoFactMetricsToCreate: AutoFactMetricToCreate[];
              }>(`/fact-tables/${factTableId}/auto-metrics`, {
                method: "GET",
              });
              console.log({ res });
              setAutoFactMetricsToCreate(res.autoFactMetricsToCreate);
            } catch (e) {
              console.log(e.message);
            }
          }}
        >
          Get Auto Metrics To Create
        </Button>
      </>
    </Modal>
  );
}
