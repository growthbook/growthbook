import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { SavedGroupTargeting } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SavedGroupBadge } from "@/components/Features/SavedGroupBadge";
import { PlainEntityBadge } from "@/components/Features/EntityBadge";
import Text from "@/ui/Text";
import ValueGroup from "@/components/Features/ValueGroup";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
  initialAnd?: boolean;
  prefix?: ReactNode;
}

function getDescription({
  match,
  ids,
}: SavedGroupTargeting): MessageDescriptor {
  switch (match) {
    case "any":
      return ids.length > 1 ? msg`in any of the groups` : msg`in group`;
    case "all":
      return ids.length > 1 ? msg`in all of the groups` : msg`in group`;
    case "none":
      return ids.length > 1 ? msg`in none of the groups` : msg`not in group`;
  }
}

export default function SavedGroupTargetingDisplay({
  savedGroups,
  initialAnd = false,
  prefix,
}: Props) {
  const { i18n } = useLingui();
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {savedGroups?.map((s, i) => {
        return (
          <Flex wrap="wrap" gap="2" key={"savedGroup-" + i}>
            {i === 0 && prefix}
            {i || initialAnd ? (
              <Text weight="medium">
                <Trans>AND</Trans>
              </Text>
            ) : null}
            <Text>{i18n._(getDescription(s))}</Text>
            <ValueGroup parens={s.ids.length > 1}>
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
            </ValueGroup>
          </Flex>
        );
      })}
    </>
  );
}
