import { createContext, FC, useContext, useEffect } from "react";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";

export type TagsContextValue = {
  refreshTags: () => void;
  error?: Error;
  tags: string[];
  tagsReady: boolean;
};

const TagsContext = createContext<TagsContextValue>({
  refreshTags: () => {
    /* */
  },
  tagsReady: false,
  error: undefined,
  tags: [],
});

export default TagsContext;

export const useTags = (): TagsContextValue => {
  return useContext(TagsContext);
};

export const TagsProvider: FC = ({ children }) => {
  const { data, error, mutate } = useApi<{
    tags: string[];
  }>(`/tags`);

  const { orgId } = useAuth();
  useEffect(() => {
    if (orgId) {
      mutate();
    }
  }, [orgId]);

  return (
    <TagsContext.Provider
      value={{
        refreshTags: mutate,
        error: error,
        tags: data ? data.tags : [],
        tagsReady: data ? true : false,
      }}
    >
      {children}
    </TagsContext.Provider>
  );
};
