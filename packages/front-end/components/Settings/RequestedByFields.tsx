import { FC } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { RequesterExtension } from "shared/permissions";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

const RequestedByFields: FC<{
  required: boolean;
  setRequired: (required: boolean) => void;
  extension: RequesterExtension;
  setExtension: (extension: RequesterExtension) => void;
}> = ({ required, setRequired, extension, setExtension }) => (
  <Box mt="6">
    <Heading as="h4" size="sm" mb="1">
      X-GrowthBook-Requested-By
    </Heading>
    <Text as="p" color="text-mid" mb="3">
      Requests can send an{" "}
      <code>X-GrowthBook-Requested-By: userid || email</code> header to act for
      that member: history, drafts and reviews show them next to this key.
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
        <Flex align="center" gap="1">
          <Text as="label" weight="semibold" mb="0">
            Extend permissions
          </Text>
          <Tooltip content="“Always” adds the named member's permissions to this key's own. “For specific permissions” adds an Applies column below, so chosen rules apply only as far as the member has them.">
            <span style={{ display: "inline-flex" }}>
              <PiInfo color="var(--color-text-low)" />
            </span>
          </Tooltip>
        </Flex>
        <Select
          value={extension}
          setValue={(value) => setExtension(value as RequesterExtension)}
        >
          <SelectItem value="none">No</SelectItem>
          <SelectItem value="all">Always</SelectItem>
          <SelectItem value="specific">For specific permissions</SelectItem>
        </Select>
        <Box>
          {extension === "all" && (
            <HelperText status="warning" size="sm">
              Requesters aren&apos;t verified. This key can act as any member
              with full permissions.
            </HelperText>
          )}
          {extension === "specific" && (
            <HelperText status="info" size="sm">
              Requesters aren&apos;t verified. This key can act as any member
              for specific permissions.
            </HelperText>
          )}
        </Box>
      </Grid>
    </Frame>
  </Box>
);

export default RequestedByFields;
