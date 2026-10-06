import { FC } from "react";
import { RequestedByPolicy } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { HelpCheckbox } from "@/components/GeneralSettings/ApprovalScopeFields";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

const RequestedByPolicyFields: FC<{
  value: RequestedByPolicy;
  setValue: (value: RequestedByPolicy) => void;
}> = ({ value, setValue }) => {
  const set = (changes: Partial<RequestedByPolicy>) =>
    setValue({ ...value, ...changes });

  return (
    <Box mt="6">
      <Heading as="h4" size="sm" mb="1">
        X-Requested-By
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Lets requests name the member who asked. History shows them next to this
        key.
      </Text>
      <HelpCheckbox
        id="requested-by-accept"
        label="Accept X-Requested-By"
        value={value.mode !== "off"}
        setValue={(accept) =>
          set(
            accept
              ? { mode: "optional" }
              : { mode: "off", limitToRequester: false },
          )
        }
      />
      {value.mode !== "off" && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <HelpCheckbox
            id="requested-by-required"
            label="Require it on every request"
            value={value.mode === "required"}
            setValue={(required) =>
              set(
                required
                  ? { mode: "required" }
                  : // The limit only holds when no request can leave the header out.
                    { mode: "optional", limitToRequester: false },
              )
            }
          />
          <HelpCheckbox
            id="requested-by-limit"
            label="Cap at the requester's permissions"
            help="Requests can only do what both this key and the named member may do. It never adds permissions, and it relies on the service holding this key to name the right member."
            value={value.limitToRequester}
            setValue={(limitToRequester) =>
              set({
                limitToRequester,
                ...(limitToRequester ? { mode: "required" } : {}),
              })
            }
          />
        </Flex>
      )}
    </Box>
  );
};

export default RequestedByPolicyFields;
