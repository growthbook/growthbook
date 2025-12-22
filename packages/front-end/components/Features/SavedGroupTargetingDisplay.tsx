import { SavedGroupTargeting } from "back-end/types/feature";
import { Flex, Text } from "@radix-ui/themes";
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
                const link =
                  group.type === "list"
                    ? `/saved-groups/${group.id}`
                    : `/saved-groups?q=${encodeURIComponent(group.groupName)}#conditionGroups`;
                return (
                  <Badge
                    key={id}
                    color="gray"
                    label={
                      <Link
                        href={link}
                        title="Manage Saved Group"
                        size="1"
                        target="_blank"
                        color="violet"
                      >
                        {group.groupName}
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
