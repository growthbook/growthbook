import React, { FC, useEffect } from "react";
import ReactPaginate from "react-paginate";
import { useRouter } from "next/router";
import { GBArrowLeft, GBArrowRight } from "./Icons";

type PaginationProps = {
  numItemsTotal: number;
  perPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  className?: string;
};

const Pagination: FC<PaginationProps> = ({
  numItemsTotal,
  perPage,
  currentPage,
  onPageChange,
  className = "",
}) => {
  const router = useRouter();
  // Set initial page based on URL query
  useEffect(() => {
    if (router.query.page) {
      let parsedPage = parseInt(router.query.page as string) || 1;
      if (parsedPage < 1) {
        parsedPage = 1;
      } else if (parsedPage > Math.ceil(numItemsTotal / perPage)) {
        parsedPage = Math.ceil(numItemsTotal / perPage);
      }
      if (parsedPage && parsedPage !== currentPage) {
        setTimeout(() => {
          onPageChange(parsedPage);
        }, 2);
      }
    }
  }, [currentPage, numItemsTotal, onPageChange, perPage, router.query.page]);

  return (
    <div className={`pagination-area ${className}`}>
      <ReactPaginate
        previousLabel={
          <>
            <GBArrowLeft /> previous
          </>
        }
        nextLabel={
          <>
            next <GBArrowRight />
          </>
        }
        breakLabel={"..."}
        breakClassName={"break-me"}
        pageCount={Math.ceil(numItemsTotal / perPage)}
        marginPagesDisplayed={2}
        pageRangeDisplayed={5}
        forcePage={currentPage - 1}
        onPageChange={(d) => {
          if (d.selected === 1) {
            router.push({ pathname: router.pathname }, undefined, {
              shallow: true,
            });
          } else {
            router.push(
              {
                pathname: router.pathname,
                query: { ...router.query, page: d.selected + 1 },
              },
              undefined,
              { shallow: true }
            );
          }
          onPageChange(d.selected + 1);
        }}
        containerClassName={`pagination justify-content-center mb-0`}
        pageClassName={"page-item"}
        disabledClassName={"disabled"}
        pageLinkClassName={"page-link link-number"}
        previousClassName={"page-item"}
        nextClassName={"page-item"}
        nextLinkClassName={"page-link link-text link-text-next"}
        previousLinkClassName={"page-link link-text link-text-prev"}
        activeClassName={"active"}
      />
    </div>
  );
};
export default Pagination;
