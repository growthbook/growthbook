import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import Pagination from "@/ui/Pagination";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

/**
 * Client-side page size over rows already fetched, so changing it costs no
 * extra request. Capped at 100 because that is all either endpoint returns for
 * a window, so a larger option could never fill a page.
 */
export const STREAM_ROWS_PER_PAGE_OPTIONS = [10, 15, 20, 50, 100];
export const STREAM_DEFAULT_ROWS_PER_PAGE = 15;

interface Props {
  /** The filtered, sorted length — not the page's length. */
  numItemsTotal: number;
  perPage: number;
  setPerPage: (perPage: number) => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  options?: number[];

  /**
   * Pagination carries 12px of its own vertical padding, which would otherwise
   * stack with a card's 24px. Set this inside a Frame so the gap to the card
   * edge reads as 24px.
   */
  pullBottom?: boolean;

  /**
   * What the rows are, set directly right of the page-size control: "1–15 of
   * 60 most recent". Omitted renders nothing there, as before.
   */
  summary?: ReactNode;
  /** Hides the pager, for a state with no rows to page through. */
  hidePager?: boolean;
}

/**
 * The footer under a log-stream table: page size on the left, pages on the
 * right. Shared by the Event Logs stream and the feature Diagnostics evaluation
 * stream, alongside StreamTable.module.scss, so the two are the same footer
 * rather than two that resemble each other.
 *
 * The page and page-size state stay with the host: both surfaces need the page
 * size for the slice and for the height they reserve for a full page of rows,
 * so a component that owned it would have to hand it straight back.
 */
export default function StreamPagination({
  numItemsTotal,
  perPage,
  setPerPage,
  currentPage,
  onPageChange,
  options = STREAM_ROWS_PER_PAGE_OPTIONS,
  pullBottom = false,
  summary,
  hidePager = false,
}: Props) {
  return (
    <Flex justify="between" align="center" mb={pullBottom ? "-3" : "0"}>
      <Flex gap="2" align="center">
        <Text color="text-low" size="sm">
          Rows per page
        </Text>
        <Select
          size="sm"
          value={String(perPage)}
          setValue={(v) => {
            setPerPage(Number(v));
            // A page number only means something against a page size. Resetting
            // here rather than in each host so no caller can forget it.
            onPageChange(1);
          }}
        >
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {String(n)}
            </SelectItem>
          ))}
        </Select>
        {/* 4px on top of the row's gap, so the count reads as its own item
            rather than as the select's value. */}
        {summary !== undefined && (
          <span style={{ marginLeft: 4 }}>
            <Text color="text-low" size="sm" whiteSpace="nowrap">
              {summary}
            </Text>
          </span>
        )}
      </Flex>
      <Flex gap="3" align="center">
        {!hidePager && (
          <Pagination
            numItemsTotal={numItemsTotal}
            perPage={perPage}
            currentPage={currentPage}
            onPageChange={onPageChange}
            previousLabel={<PiCaretLeft size={14} />}
            nextLabel={<PiCaretRight size={14} />}
          />
        )}
      </Flex>
    </Flex>
  );
}
