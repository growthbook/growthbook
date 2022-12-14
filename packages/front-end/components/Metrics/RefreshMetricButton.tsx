import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import Button from "../Button";

const RefreshMetricButton: FC<{
  mutate: () => void;
  metric: string;
}> = ({ mutate, metric }) => {
  const { apiCall } = useAuth();

  const refresh = async () => {
    const res = await apiCall<{ status: number; message: string }>(
      `/metric/${metric}/analysis`,
      {
        method: "POST",
      }
    );

    if (res.status !== 200) {
      throw new Error(res.message || "There was an error refreshing results");
    }
    mutate();
  };

  return (
    <>
      <Button color="outline-primary" onClick={refresh}>
        <BsArrowRepeat /> Refresh
      </Button>
    </>
  );
};

export default RefreshMetricButton;
