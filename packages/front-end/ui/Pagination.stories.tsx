import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Pagination from "./Pagination";

export default function PaginationStories() {
  const [tenPageCurrentPage, setTenPageCurrentPage] = useState(1);
  const [hundredPageCurrentPage, setHundredPageCurrentPage] = useState(98);
  const [twoPageCurrentPage, setTwoPageCurrentPage] = useState(1);
  const [singlePageCurrentPage, setSinglePageCurrentPage] = useState(1);

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>Fixed positions across pages</span>
        {[1, 50, 100].map((currentPage) => (
          <Flex key={currentPage} direction="column" gap="1">
            <Pagination
              numItemsTotal={5000}
              perPage={50}
              currentPage={currentPage}
              onPageChange={() => undefined}
            />
            <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
              Current page: {currentPage}
            </span>
          </Flex>
        ))}
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          10 pages (100 items, 10 per page)
        </span>
        <Pagination
          numItemsTotal={100}
          perPage={10}
          currentPage={tenPageCurrentPage}
          onPageChange={setTenPageCurrentPage}
        />
        <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
          Current page: {tenPageCurrentPage}
        </span>
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          100 pages (5,000 items, 50 per page)
        </span>
        <Pagination
          numItemsTotal={5000}
          perPage={50}
          currentPage={hundredPageCurrentPage}
          onPageChange={setHundredPageCurrentPage}
        />
        <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
          Current page: {hundredPageCurrentPage}
        </span>
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          Two pages (15 items, 10 per page)
        </span>
        <Pagination
          numItemsTotal={15}
          perPage={10}
          currentPage={twoPageCurrentPage}
          onPageChange={setTwoPageCurrentPage}
        />
        <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
          Current page: {twoPageCurrentPage}
        </span>
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          Single page (5 items, 10 per page)
        </span>
        <Pagination
          numItemsTotal={5}
          perPage={10}
          currentPage={singlePageCurrentPage}
          onPageChange={setSinglePageCurrentPage}
        />
        <span style={{ fontSize: 14, color: "var(--gray-11)" }}>
          Current page: {singlePageCurrentPage}
        </span>
      </Flex>
    </Flex>
  );
}
