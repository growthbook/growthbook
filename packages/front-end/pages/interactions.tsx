import { Box } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";

const InteractionsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Frame>
        <Heading as="h1" mb="5">
          Interactions
        </Heading>
        <p>This is the Interactions page.</p>
        <p>Here you can view and manage interactions.</p>
        <p>More content will be added soon!</p>
      </Frame>
    </Box>
  );
};

export default InteractionsPage;
