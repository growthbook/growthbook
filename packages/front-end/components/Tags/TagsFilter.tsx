import { useState } from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useDefinitions } from "../../services/DefinitionsContext";
import TagsInput from "./TagsInput";

interface ItemWithTags {
  tags?: string[];
}

interface TagsFilter {
  tags: string[];
  setTags: (tags: string[]) => void;
}

export interface Props {
  filter: TagsFilter;
  items: ItemWithTags[];
}

export function filterByTags<T extends ItemWithTags>(
  items: T[],
  { tags }: TagsFilter
): T[] {
  if (!tags.length) return items;

  return items.filter((item) => {
    if (!item.tags) return false;
    for (let i = 0; i < tags.length; i++) {
      if (!item.tags.includes(tags[i])) return false;
    }
    return true;
  });
}

export function useTagsFilter(page: string): TagsFilter {
  const [tags, setTags] = useLocalStorage<string[]>(page + ":tags-filter", []);
  return {
    tags,
    setTags,
  };
}

export default function TagsFilter({
  filter: { tags, setTags },
  items,
}: Props) {
  const [open, setOpen] = useState(false);
  const counts: Record<string, number> = {};
  const availableTags: string[] = [];
  const { getTagById } = useDefinitions();
  items.forEach((item) => {
    if (item.tags) {
      item.tags.forEach((tag) => {
        counts[tag] = counts[tag] || 0;
        counts[tag]++;
        if (!availableTags.includes(tag)) {
          availableTags.push(tag);
        }
      });
    }
  });

  tags.forEach((tag) => {
    if (!availableTags.includes(tag)) {
      availableTags.push(tag);
    }
  });

  availableTags.sort((a, b) => {
    return (counts[b] || 0) - (counts[a] || 0);
  });

  if (!tags.length && !availableTags.length) return null;

  if (!open && !tags.length) {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        Filter by tags...
      </a>
    );
  }

  return (
    <div style={{ minWidth: 207 }}>
      <TagsInput
        value={tags}
        onChange={(value) => {
          setTags(value);
        }}
        prompt={"Filter by tags..."}
        autoFocus={open}
        closeMenuOnSelect={true}
        tagOptions={availableTags.map((t) => getTagById(t)).filter(Boolean)}
        creatable={false}
      />
    </div>
  );
}
