import { SavedGroupTargeting } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SavedGroupBadge } from "@/components/Features/SavedGroupBadge";
import { PlainEntityBadge } from "@/components/Features/EntityBadge";
import Text from "@/ui/Text";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
  initialAnd?: boolean;
  groupClassName?: string;
  prefix?: ReactNode;
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
  prefix,
}: Props) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {savedGroups?.map((s, i) => {
        return (
          <Flex
            wrap="wrap"
            gap="2"
            className={i === 0 && prefix ? undefined : groupClassName}
            key={"savedGroup-" + i}
          >
            {i === 0 && prefix}
            {i || initialAnd ? <Text weight="medium">AND</Text> : null}
            <Text>{getDescription(s)}</Text>
            <Flex wrap="wrap" gap="2">
              {s.ids.length > 1 && "("}
              {s.ids.map((id) => {
                const group = getSavedGroupById(id);
                if (!group) {
                  return <PlainEntityBadge key={id} label={id} />;
                }
                return (
                  <SavedGroupBadge
                    key={id}
                    groupId={group.id}
                    groupName={group.groupName}
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
