import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiHourglassMedium } from "react-icons/pi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Tabs",
  category: "navigation",
  status: "stable",
  summary:
    "Tabs that switch between panels of related content on the same page.",
  useWhen: [
    "Split a page into peer sections the user switches between.",
    "Replace legacy Bootstrap nav-tabs.",
  ],
  avoidWhen: [
    {
      reason: "You are choosing a value or mode in a form.",
      use: "SegmentedControl",
    },
    {
      reason: "The sections are ordered steps in a flow.",
      use: "Stepper",
    },
  ],
  related: ["SegmentedControl"],
};

export default function TabsStories() {
  const [activeControlledTab, setActiveControlledTab] = useState("tab1");

  return (
    <Flex direction="column" gap="3">
      <Box>
        Uncontrolled tabs with persistence in the URL
        <Tabs defaultValue="tab1" persistInURL={true}>
          <TabsList>
            <TabsTrigger value="tab1">
              <PiHourglassMedium style={{ color: "var(--accent-10)" }} /> Tab 1
            </TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>

          <Box p="4">
            <TabsContent value="tab1">Tab 1 content</TabsContent>
            <TabsContent value="tab2">Tab 2 content</TabsContent>
          </Box>
        </Tabs>
      </Box>

      <Box>
        Tabs are lazy loaded by default, but you can use forceMount to disable
        this behavior (see console for output).
        <Tabs
          value={activeControlledTab}
          onValueChange={(tab) => setActiveControlledTab(tab)}
        >
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
            <TabsTrigger value="tab3">Tab 3 (forcibly mounted)</TabsTrigger>
          </TabsList>
          <Box p="4">
            <TabsContent value="tab1">
              <TabContentExample number={1} />
            </TabsContent>
            <TabsContent value="tab2">
              <TabContentExample number={2} />
            </TabsContent>
            <TabsContent value="tab3" forceMount>
              <TabContentExample number={3} />
            </TabsContent>
          </Box>
        </Tabs>
      </Box>
    </Flex>
  );
}

function TabContentExample({ number }: { number: number }) {
  useEffect(
    () => console.log(`Tab number ${number} content mounted`),
    [number],
  );

  return <>Tab number {number} content</>;
}
