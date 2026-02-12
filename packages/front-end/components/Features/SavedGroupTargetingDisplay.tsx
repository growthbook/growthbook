import { SavedGroupTargeting } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { ReactNode } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

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
                        title={`Manage Saved Group: ${group.groupName}`}
                        target="_blank"
                        color="violet"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "400px",
                          }}
                        >
                          {group.groupName}
                        </span>
                        <PiArrowSquareOut style={{ flexShrink: 0 }} />
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
