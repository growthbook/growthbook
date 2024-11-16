import { useEffect, useState } from "react";
import { isDefined } from "shared/util";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsInput from "./TagsInput";

// 定义带有标签的项目接口
interface ItemWithTags {
  tags?: string[];
}

// 定义标签筛选器接口
interface TagsFilter {
  tags: string[];
  setTags: (tags: string[]) => void;
}

// 定义组件属性接口
export interface Props {
  filter: TagsFilter;
  items: ItemWithTags[];
}

// 根据标签筛选项目的函数
export function filterByTags<T extends ItemWithTags>(
  items: T[],
  tags: string[]
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

// 使用本地存储获取标签筛选器的函数
export function useTagsFilter(page: string): TagsFilter {
  const [tags, setTags] = useLocalStorage<string[]>(page + ":tags-filter", []);
  return {
    tags,
    setTags,
  };
}

// 标签筛选组件默认导出函数
export default function TagsFilter({
  filter: { tags, setTags },
  items,
}: Props) {
  const [open, setOpen] = useState(false);
  const [autofocus, setAutofocus] = useState(false);
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

  // 仅在点击“按标签筛选”后短暂开启自动聚焦
  useEffect(() => {
    if (!autofocus) return;
    const timer = setTimeout(() => {
      setAutofocus(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [autofocus]);

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
          setAutofocus(true);
        }}
      >
        按标签筛选...
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
        prompt="按标签筛选..."
        autoFocus={open && autofocus}
        closeMenuOnSelect={true}
        tagOptions={availableTags.map((t) => getTagById(t)).filter(isDefined)}
        creatable={false}
      />
    </div>
  );
}