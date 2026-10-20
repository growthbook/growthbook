import { getValidDateOffsetByUTC } from "shared/dates";
import { formatCompactDateRange } from "@/components/DatePicker";

function date(iso: string): Date {
  return getValidDateOffsetByUTC(iso);
}

describe("formatCompactDateRange", () => {
  it("shows a single date when start and end are the same calendar day", () => {
    expect(formatCompactDateRange(date("2026-04-20"), date("2026-04-20"))).toBe(
      "April 20, 2026",
    );
  });

  it("compacts same month and year to Month start-end, year", () => {
    expect(formatCompactDateRange(date("2026-04-20"), date("2026-04-24"))).toBe(
      "April 20-24, 2026",
    );
  });

  it("shows both months when same year but different month", () => {
    expect(formatCompactDateRange(date("2026-03-20"), date("2026-04-20"))).toBe(
      "March 20 - April 20, 2026",
    );
  });

  it("shows full dates when years differ", () => {
    expect(formatCompactDateRange(date("2025-03-20"), date("2026-04-20"))).toBe(
      "March 20, 2025 - April 20, 2026",
    );
  });
});
