import { useCallback, useState } from "react";

export type PaginationOptions<T = unknown> = {
  items: T[];
  pageSize: number;
};

export type UsePagination<T = unknown> = {
  pageCount: number;
  currentPage: number;
  visibleItems: T[];
  onPageChange: (pageNumber: number) => void;
};

/**
 * Meant to be used with the {@link Pagination}
 * @param items
 * @param pageSize
 */
export const usePagination = <T = unknown>({
  items,
  pageSize,
}: PaginationOptions<T>): UsePagination<T> => {
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.ceil(items.length / pageSize);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  const visibleItems = items.slice(startIndex, endIndex);

  const onPageChange = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
  }, []);

  return {
    pageCount,
    currentPage,
    visibleItems,
    onPageChange,
  };
};
