import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";

// Visual shell only - no backend query, no live sample rows. Preview/SQL
// are real Tabs (not just a styled Button pair) so the control already has
// correct keyboard/aria-selected behavior once real content lands here.
export default function PreviewPanel() {
  return (
    <Frame>
      <Heading as="h4" size="sm" mb="3">
        Preview
      </Heading>
      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="sql">SQL</TabsTrigger>
        </TabsList>
        <TabsContent value="preview">
          <Text color="text-mid" as="div" mt="3">
            Finish the metric definition to see a preview.
          </Text>
        </TabsContent>
        <TabsContent value="sql">
          <Text color="text-mid" as="div" mt="3">
            Finish the metric definition to see the generated SQL.
          </Text>
        </TabsContent>
      </Tabs>
    </Frame>
  );
}
