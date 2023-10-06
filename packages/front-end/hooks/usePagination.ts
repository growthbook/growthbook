import { useCallback, useState } from "react";

export type PaginationOptions<T = unknown> = {
  items: T[];
  pageSize: number;
};

export type UsePagination<T = unknown> = {
  /**
   * List of items currently visible
   */
  visibleItems: T[];

  /**
   * Total number of pages
   */
  pageCount: number;

  /**
   * Total number of items in the items list
   */
  totalCount: number;

  /**
   * Current page number (starting at 1)
   */
  currentPage: number;

  /**
   * Changes the visible page
   * @param pageNumber
   */
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

  const totalCount = items.length;

  const onPageChange = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
  }, []);

  return {
    pageCount,
    totalCount,
    currentPage,
    visibleItems,
    onPageChange,
  };
};
