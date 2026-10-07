import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

const RequestedByFields: FC<{
  required: boolean;
  setRequired: (required: boolean) => void;
  extendWithRequester: boolean;
  setExtendWithRequester: (extend: boolean) => void;
  hasRequesterRows: boolean;
}> = ({
  required,
  setRequired,
  extendWithRequester,
  setExtendWithRequester,
  hasRequesterRows,
}) => (
  <Box mt="6">
    <Heading as="h4" size="sm" mb="1">
      X-Requested-By
    </Heading>
    <Text as="p" color="text-mid" mb="3">
      Requests can send a <code>X-Requested-By: userid || email</code> header to
      show the requester next to this key in history.
    </Text>
    <Flex direction="column" gap="3">
      <Checkbox
        label="Require it on every request"
        value={required}
        setValue={setRequired}
      />
      <Flex align="center" gap="1">
        <Checkbox
          label="Extend this key's permissions if the requester has them"
          value={extendWithRequester}
          setValue={setExtendWithRequester}
          // Requester-only rules would silently start applying to every request.
          disabled={hasRequesterRows}
          disabledMessage="Some rules below apply only if the requester has it. Set them back to Always to turn this off."
        />
        <Tooltip content="Adds an Applies column to the permissions below, so each rule can apply always or only if the requester has it.">
          <span style={{ display: "inline-flex" }}>
            <PiInfo color="var(--color-text-low)" />
          </span>
        </Tooltip>
      </Flex>
    </Flex>
  </Box>
);

export default RequestedByFields;
