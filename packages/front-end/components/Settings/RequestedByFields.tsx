import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

const RequestedByFields: FC<{
  required: boolean;
  setRequired: (required: boolean) => void;
}> = ({ required, setRequired }) => (
  <Box mt="6">
    <Heading as="h4" size="sm" mb="1">
      X-GrowthBook-Requested-By
    </Heading>
    <Text as="p" color="text-mid" mb="3">
      Requests can send an{" "}
      <code>X-GrowthBook-Requested-By: userid || email</code> header to act for
      that member, with only the permissions both this key and the member hold.
      History, drafts and reviews show them next to this key.
    </Text>
    <Frame py="1" px="4">
      <Grid
        columns="180px 210px 1fr"
        gapX="4"
        align="center"
        style={{ gridAutoRows: "minmax(48px, auto)" }}
      >
        <Text
          as="label"
          htmlFor="requested-by-required"
          weight="semibold"
          mb="0"
        >
          Require on all requests
        </Text>
        <Checkbox
          id="requested-by-required"
          value={required}
          setValue={setRequired}
        />
        <Box />
      </Grid>
    </Frame>
  </Box>
);

export default RequestedByFields;
