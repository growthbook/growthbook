import { Box, Heading } from "@radix-ui/themes";
import Frame from "@/components/Radix/Frame";

const InteractionsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Frame className="overflow-auto">
        <Heading>Interactions</Heading>
        <p>This is the Interactions page.</p>
        <p>Here you can view and manage interactions.</p>
        <p>More content will be added soon!</p>
      </Frame>
    </Box>
  );
};

export default InteractionsPage;
