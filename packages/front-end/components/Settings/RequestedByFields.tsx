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

const HEADER_HELP: Record<HeaderPolicy, string | null> = {
  optional: null,
  required: "Requests without it are rejected.",
  rejected: "Requests that send it are rejected.",
};

const PERMISSIONS_HELP: Record<PermissionsMode, string> = {
  assume: "Only what both this key and the member can do.",
  key: "The header only records who asked.",
};

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
      <code>X-GrowthBook-Requested-By: userid || email</code> header to name the
      member who asked. History, drafts and reviews show them next to this key.
    </Text>
    <Frame py="1" px="4">
      <Grid
        columns="180px 210px 1fr"
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
        <Box>
          {HEADER_HELP[header] && (
            <HelperText status="info" size="sm">
              {HEADER_HELP[header]}
            </HelperText>
          )}
        </Box>
        {header !== "rejected" && (
          <>
            <Text as="label" weight="semibold" mb="0">
              Permissions
            </Text>
            <Select
              value={permissions}
              setValue={(value) => setPermissions(value as PermissionsMode)}
            >
              <SelectItem value="assume">
                Assume the member&apos;s role
              </SelectItem>
              <SelectItem value="key">Use this key&apos;s role</SelectItem>
            </Select>
            <Box>
              <HelperText status="info" size="sm">
                {PERMISSIONS_HELP[permissions]}
              </HelperText>
            </Box>
          </>
        )}
      </Grid>
    </Frame>
  </Box>
);

export default RequestedByFields;
