//import { useState } from "react";
import useApi from "../../hooks/useApi";
import { RealtimeUsageInterface } from "back-end/types/realtime";

export default function RealTimeFeatures() {
  //const [currentMin, setCurrentMin] = useState(new Date().getMinutes());
  const { data, error } = useApi<{
    realtime: RealtimeUsageInterface[];
  }>(`/realtime/features`);
  const { data: summaryData, error: summaryError } = useApi<{
    realtime: RealtimeUsageInterface[];
  }>(`/realtime/summary`);

  if (!data || !summaryData || error || summaryError) {
    return null;
  }
  //console.log(currentMin);
  console.log(data);
  return <>Summary usage and Graph here</>;
}
