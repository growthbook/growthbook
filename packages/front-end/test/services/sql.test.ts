import { convertToCSV } from "@/services/sql";

describe("convertToCSV", () => {
  it("quotes header names that contain commas so one logical column stays one column", () => {
    const headerWithCommas = "Revenue per User — Nov 13, 2025 – Feb 12, 2026";
    const rows = [{ [headerWithCommas]: 1.23 }];
    const csv = convertToCSV(rows);
    const [headerLine, dataLine] = csv.split("\n");
    expect(headerLine).toBe(`"${headerWithCommas}"`);
    expect(dataLine).toBe(`"1.23"`);
  });
});
