import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

type HeaderPolicy = NonNullable<ApiKeyInterface["requesterHeader"]>;
type PermissionsMode = NonNullable<ApiKeyInterface["requesterPermissions"]>;

const RequestedByFields: FC<{
  header: HeaderPolicy;
  setHeader: (header: HeaderPolicy) => void;
  permissions: PermissionsMode;
  setPermissions: (permissions: PermissionsMode) => void;
}> = ({ header, setHeader, permissions, setPermissions }) => (
  <Box mt="6">
    <Heading as="h4" size="sm" mb="1">
      X-GrowthBook-Requested-By
    </Heading>
    <Text as="p" color="text-mid" mb="3">
      Requests can send an{" "}
      <code>X-GrowthBook-Requested-By: &lt;memberId || email&gt;</code> header
      to name the member who asked. History, drafts and reviews show them next
      to this key.
    </Text>
    <Frame py="1" px="4">
      <Grid
        columns="100px 210px 1fr"
        gapX="4"
        align="center"
        style={{ gridAutoRows: "minmax(48px, auto)" }}
      >
        <Text as="label" weight="semibold" mb="0">
          Header
        </Text>
        <Select
          value={header}
          setValue={(value) => setHeader(value as HeaderPolicy)}
        >
          <SelectItem value="optional">Optional</SelectItem>
          <SelectItem value="required">Required</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </Select>
        <Box />
        {header !== "rejected" && (
          <>
            <Text as="label" weight="semibold" mb="0">
              Permissions
            </Text>
            <Select
              value={permissions}
              setValue={(value) => setPermissions(value as PermissionsMode)}
            >
              <SelectItem value="assume">Assume member&apos;s role</SelectItem>
              <SelectItem value="key">Use key&apos;s role</SelectItem>
            </Select>
            <Box>
              {permissions === "assume" && (
                <HelperText status="info">
                  Only what both this key and the member can do.
                </HelperText>
              )}
            </Box>
          </>
        )}
      </Grid>
    </Frame>
  </Box>
);

export default RequestedByFields;
