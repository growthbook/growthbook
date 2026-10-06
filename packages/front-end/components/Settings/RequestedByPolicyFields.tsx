import { FC, useMemo } from "react";
import { RequestedByPolicy } from "shared/validators";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { Select, SelectItem } from "@/ui/Select";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";

const MODE_HELP: Record<RequestedByPolicy["mode"], string> = {
  optional:
    "Requests may name the member who asked in an X-Requested-By header. History shows them next to this key.",
  required: "Every request must name the member who asked.",
  off: "Requests can't name a member. History shows only this key.",
};

const RequestedByPolicyFields: FC<{
  value: RequestedByPolicy;
  setValue: (value: RequestedByPolicy) => void;
}> = ({ value, setValue }) => {
  const { users, teams } = useUser();
  const set = (changes: Partial<RequestedByPolicy>) =>
    setValue({ ...value, ...changes });

  const memberOptions = useMemo(
    () =>
      Array.from(users.values()).map((user) => ({
        value: user.id,
        label: user.name || user.email,
      })),
    [users],
  );
  const teamOptions = useMemo(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );
  const anyMember = !value.memberIds.length && !value.teamIds.length;

  return (
    <Box mt="4">
      <Select
        label="X-Requested-By"
        value={value.mode}
        setValue={(mode) =>
          set({
            mode: mode as RequestedByPolicy["mode"],
            // The limit only holds when no request can leave the header out.
            ...(mode !== "required" ? { limitToRequester: false } : {}),
          })
        }
        mb="1"
      >
        <SelectItem value="optional">Optional</SelectItem>
        <SelectItem value="required">Required</SelectItem>
        <SelectItem value="off">Off</SelectItem>
      </Select>
      <Text as="p" size="sm" color="text-mid" mb="3">
        {MODE_HELP[value.mode]}
      </Text>
      {value.mode !== "off" && (
        <>
          <Box mb="3">
            <Checkbox
              label="Limit each request to the requester's permissions"
              description="The key can only do what both it and the requester are allowed to do. Requires X-Requested-By on every request."
              value={value.limitToRequester}
              setValue={(limitToRequester) =>
                set({
                  limitToRequester,
                  ...(limitToRequester ? { mode: "required" } : {}),
                })
              }
            />
          </Box>
          <MultiSelectField
            label="Allowed members"
            placeholder={anyMember ? "Any member" : "None"}
            value={value.memberIds}
            onChange={(memberIds) => set({ memberIds })}
            options={memberOptions}
            sort={false}
          />
          <MultiSelectField
            label="Allowed teams"
            placeholder={anyMember ? "Any team" : "None"}
            helpText="With no members or teams chosen, any member can be named."
            value={value.teamIds}
            onChange={(teamIds) => set({ teamIds })}
            options={teamOptions}
            sort={false}
          />
        </>
      )}
    </Box>
  );
};

export default RequestedByPolicyFields;
