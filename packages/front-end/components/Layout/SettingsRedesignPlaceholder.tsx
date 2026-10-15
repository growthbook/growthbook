import { Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";

// PROTOTYPE (app header + side nav redesign): the Settings page while it's
// redesigned as a single page. Its sub-pages and SDK Configuration's are
// still at their URLs and in ⌘K search.
export default function SettingsRedesignPlaceholder() {
  return (
    <Flex
      className="container-fluid pagecontents"
      align="center"
      justify="center"
      style={{ minHeight: "calc(100vh - 44px - var(--space-9))" }}
    >
      <Heading as="h1" size="lg">
        Settings page re-design
      </Heading>
    </Flex>
  );
}
