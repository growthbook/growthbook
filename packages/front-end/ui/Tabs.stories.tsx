import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiHourglassMedium } from "react-icons/pi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";

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

      <Box>
        Tabs that don&apos;t fit fold into a More menu, keeping the selected one
        in view
        <Box style={{ width: 360 }}>
          <Tabs defaultValue="production">
            <TabsList>
              {OVERFLOW_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Box>
      </Box>

      <Box>
        With alignText, the labels line up with the padded content under them
        rather than their underlines; the list reaches past its box by a
        tab&apos;s padding on each side, so it needs that much room around it.
        <Flex direction="column" gap="4" mt="2">
          {[
            { label: "Fits", tabs: OVERFLOW_TABS.slice(0, 2), width: 480 },
            { label: "With a More menu", tabs: OVERFLOW_TABS, width: 360 },
          ].map(({ label, tabs, width }) => (
            <Box
              key={label}
              p="5"
              style={{
                width,
                border: "1px solid var(--gray-a5)",
                borderRadius: "var(--radius-3)",
              }}
            >
              <Tabs defaultValue={tabs[0]}>
                <TabsList alignText>
                  {tabs.map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {tab}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Box mt="3">
                {label}: the first label starts where this text does.
              </Box>
            </Box>
          ))}
        </Flex>
      </Box>
    </Flex>
  );
}

const OVERFLOW_TABS = [
  "production",
  "staging",
  "development",
  "qa",
  "canary",
  "sandbox",
];

function TabContentExample({ number }: { number: number }) {
  useEffect(
    () => console.log(`Tab number ${number} content mounted`),
    [number],
  );

  return <>Tab number {number} content</>;
}
