import { useDefinitions } from "@/services/DefinitionsContext";
import Tag from "./Tag";

export interface Props {
  tags?: string[];
}

export default function SortedTags({ tags }: Props) {
  const { tags: all } = useDefinitions();

  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

  return (
    <>
      {sorted.map((tag) => (
        <Tag tag={tag} key={tag} />
      ))}
    </>
  );
}
