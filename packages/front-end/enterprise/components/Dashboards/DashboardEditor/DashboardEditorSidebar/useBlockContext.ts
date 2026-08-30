import { useState, useEffect } from "react";
import { BlockContext } from "./types";

// Global state container for block contexts
const BlockContextValues = new Map<string, BlockContext | null>();

// Event system for notifying context changes
const contextChangeListeners = new Set<(blockId: string) => void>();

const notifyContextChange = (blockId: string) => {
  contextChangeListeners.forEach((listener) => listener(blockId));
};

// Function to set context value for a block (called by block components)
export const setBlockContextValue = (
  blockId: string | null,
  value: BlockContext | null,
) => {
  const key = blockId || "__new__";
  BlockContextValues.set(key, value);
  notifyContextChange(key);
};

// Hook to get context value for a block (called by EditSingleBlock)
export const useBlockContext = (blockId: string | null) => {
  const key = blockId || "__new__";
  const [context, setContext] = useState<BlockContext | null>(
    BlockContextValues.get(key) || null,
  );

  useEffect(() => {
    const handleContextChange = (changedBlockId: string) => {
      if (changedBlockId === key) {
        setContext(BlockContextValues.get(key) || null);
      }
    };

    contextChangeListeners.add(handleContextChange);

    return () => {
      contextChangeListeners.delete(handleContextChange);
    };
  }, [key]);

  return context;
};
