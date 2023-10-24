import { useDefinitions } from "@/services/DefinitionsContext";
import Tag from "./Tag";

export interface Props {
  tags?: string[];
  skipFirstMargin?: boolean;
  shouldShowEllipsis?: boolean;
}

export default function SortedTags({
  tags,
  skipFirstMargin,
  shouldShowEllipsis,
}: Props) {
  const { tags: all } = useDefinitions();
  //index starting at 0
  const SHOW_ELLIPSIS_AT_INDEX = 4;
  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

  const renderTag = () => {
    //only whant to show ellipsis if the length is >  SHOW_ELLIPSIS_AT_INDEX;
    shouldShowEllipsis =
      shouldShowEllipsis && sorted.length - 1 !== SHOW_ELLIPSIS_AT_INDEX;

    return sorted.map((tag, i) => {
      if (i === SHOW_ELLIPSIS_AT_INDEX && !!shouldShowEllipsis) {
        return <Tag tag="&hellip;" key="tag-ellipsis" />;
      } else if (i < SHOW_ELLIPSIS_AT_INDEX || !shouldShowEllipsis) {
        return (
          <Tag tag={tag} key={tag} skipMargin={skipFirstMargin && i === 0} />
        );
      }

      return null;
    });
  };

  return <>{renderTag()}</>;
}
