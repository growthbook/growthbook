import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Pagination from "./Pagination";

export default function PaginationStories() {
  const [currentPage, setCurrentPage] = useState(1);
  const numItemsTotal = 50;
  const perPage = 10;

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          Multiple pages (50 items, 10 per page)
        </span>
        <Pagination
          numItemsTotal={numItemsTotal}
          perPage={perPage}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
        <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
          Current page: {currentPage}
        </span>
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          Single page (5 items, 10 per page)
        </span>
        <Pagination
          numItemsTotal={5}
          perPage={10}
          currentPage={1}
          onPageChange={() => {}}
        />
      </Flex>
    </Flex>
  );
}
