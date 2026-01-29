import { SavedGroupTargeting } from "shared/types/feature";
import { Flex, Text } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
  initialAnd?: boolean;
  groupClassName?: string;
}

function getDescription({ match, ids }: SavedGroupTargeting): string {
  switch (match) {
    case "any":
      return ids.length > 1 ? "in any of the groups" : "in group";
    case "all":
      return ids.length > 1 ? "in all of the groups" : "in group";
    case "none":
      return ids.length > 1 ? "in none of the groups" : "not in group";
  }
}

export default function SavedGroupTargetingDisplay({
  savedGroups,
  initialAnd = false,
  groupClassName = "",
}: Props) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {savedGroups?.map((s, i) => {
        return (
          <Flex
            wrap="wrap"
            gap="2"
            className={groupClassName}
            key={"savedGroup-" + i}
          >
            {i || initialAnd ? <Text weight="medium">AND</Text> : null}
            {getDescription(s)}
            <Flex wrap="wrap" gap="2">
              {s.ids.length > 1 && "("}
              {s.ids.map((id) => {
                const group = getSavedGroupById(id);
                if (!group) {
                  return (
                    <Badge key={id} color="gray" label={<Text>{id}</Text>} />
                  );
                }
                return (
                  <Badge
                    key={id}
                    color="gray"
                    label={
                      <Link
                        href={`/saved-groups/${group.id}`}
                        title="Manage Saved Group"
                        target="_blank"
                        color="violet"
                      >
                        {group.groupName} <PiArrowSquareOut />
                      </Link>
                    }
                  />
                );
              })}
              {s.ids.length > 1 && ")"}
            </Flex>
          </Flex>
        );
      })}
    </>
  );
}
