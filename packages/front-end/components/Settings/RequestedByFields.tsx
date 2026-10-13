import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";

type HeaderPolicy = NonNullable<ApiKeyInterface["requesterHeader"]>;
type PermissionsMode = NonNullable<ApiKeyInterface["requesterPermissions"]>;

const HEADER_HELP: Record<HeaderPolicy, string> = {
  optional: "Used when a request sends this header.",
  required: "Requests without this header are rejected.",
  rejected: "Requests with this header are rejected.",
};

const PERMISSIONS_HELP: Record<PermissionsMode, string> = {
  assume: "Acts as the member, limited to what this key can also do.",
  key: "Acts as the key. The name is only logged.",
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
      <code>X-GrowthBook-Requested-By: &lt;memberId || email&gt;</code> header
      to name the member who asked.
    </Text>
    <Frame py="1" px="3">
      <Grid
        columns="100px 210px 1fr"
        gapX="4"
        align="center"
        style={{ gridAutoRows: "minmax(40px, auto)" }}
      >
        <Text as="label" weight="semibold" mb="0">
          Header
        </Text>
        <SelectField
          aria-label="Header"
          size="small"
          sort={false}
          isSearchable={false}
          value={header}
          onChange={(value) => setHeader(value as HeaderPolicy)}
          options={[
            { label: "Optional", value: "optional" },
            { label: "Required", value: "required" },
            { label: "Rejected", value: "rejected" },
          ]}
        />
        <Text size="sm" color="text-mid">
          {HEADER_HELP[header]}
        </Text>
        {header !== "rejected" && (
          <>
            <Text as="label" weight="semibold" mb="0">
              Permissions
            </Text>
            <SelectField
              aria-label="Permissions"
              size="small"
              sort={false}
              isSearchable={false}
              value={permissions}
              onChange={(value) => setPermissions(value as PermissionsMode)}
              options={[
                { label: "Assume member's role", value: "assume" },
                { label: "Use key's role", value: "key" },
              ]}
            />
            <Text size="sm" color="text-mid">
              {PERMISSIONS_HELP[permissions]}
            </Text>
          </>
        )}
      </Grid>
    </Frame>
  </Box>
);

export default RequestedByFields;
