import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";

export default function MetricPage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="experiments">Experiments</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <MetricOverview />
      </TabsContent>
      <TabsContent value="experiments">
        <MetricExperiments />
      </TabsContent>
      <TabsContent value="history">
        <MetricHistory />
      </TabsContent>
    </Tabs>
  );
}
