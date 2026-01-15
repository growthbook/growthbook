import { FC, useState } from "react";
import { AuditInterface } from "shared/types/audit";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { HistoryTableRow } from "@/components/HistoryTable";
import track from "@/services/track";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/ui/Tabs";
import ApprovalFlowList from "@/components/ApprovalFlow/ApprovalFlowList";
import { useApprovalFlows } from "@/hooks/useApprovalFlows";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Box } from "@radix-ui/themes";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import router, { useRouter } from "next/router";

const Activity: FC = () => {
  const router = useRouter();
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  track("Viewed Activity Page");
  const { approvalFlows, isLoading} = useApprovalFlows();
  const [tab, setTab] = useLocalStorage<"approvals" | "watched">("activityTab", "approvals");
  const [open, setOpen] = useState("");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const setApprovalFlow = (flow: ApprovalFlowInterface) => {
    const mapEntityType = {
      "fact-metric": "fact-metrics",
      "fact-table": "fact-table",
    }
    router.push(
      `/${mapEntityType[flow.entityType]}/${flow.entityId}?approvalFlowId=${encodeURIComponent(flow.id)}#approvals`,
    );
  }
        
  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "approvals" | "watched")}>
      <TabsList>
        <TabsTrigger value="approvals">Approvals</TabsTrigger>
        <TabsTrigger value="activity">Watched</TabsTrigger>
      </TabsList>
      <Box p="4">
      <TabsContent value="approvals">
        <ApprovalFlowList approvalFlows={approvalFlows} isLoading={isLoading} setApprovalFlow={setApprovalFlow} showEntityType={true} showHistory={false}/>
      </TabsContent>
      <TabsContent value="watched">
      <div className="container-fluid">
      <h3>Activity - Last 7 Days</h3>
      <p>Includes all watched features and experiments.</p>
      {data.events.length > 0 ? (
        <table className="table appbox">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Name</th>
              <th>User</th>
              <th>Event</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((event) => (
              <HistoryTableRow
                event={event}
                key={event.id}
                open={open === event.id}
                setOpen={(open) => {
                  setOpen(open ? event.id : "");
                }}
                showName={true}
                showType={true}
                itemName={
                  nameMap.has(event.entity.id)
                    ? nameMap.get(event.entity.id)
                    : undefined
                }
                url={
                  event.entity.object === "feature"
                    ? `/features/${event.entity.id}`
                    : `/${event.entity.object}/${event.entity.id}`
                }
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          <em>No recent events</em>
        </p>
      )}
    </div>
      </TabsContent>
      </Box>
      </Tabs>
  );
};

export default Activity;
