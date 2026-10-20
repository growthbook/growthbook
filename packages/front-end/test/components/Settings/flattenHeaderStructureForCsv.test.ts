import {
  flattenHeaderStructureForCsv,
  type HeaderStructure,
} from "@/components/Settings/flattenHeaderStructureForCsv";

describe("flattenHeaderStructureForCsv", () => {
  it("flattens dimension rowSpan 2 plus ratio metric colSpan 3", () => {
    const headerStructure: HeaderStructure = {
      row1: [
        { label: "Date", rowSpan: 2 },
        { label: "Revenue", colSpan: 3 },
      ],
      row2Labels: ["Numerator", "Denominator", "Value"],
    };

    expect(flattenHeaderStructureForCsv(headerStructure)).toEqual([
      "Date",
      "Revenue — Numerator",
      "Revenue — Denominator",
      "Revenue — Value",
    ]);
  });

  it("flattens compare-style dimension plus metric colSpan 2", () => {
    const headerStructure: HeaderStructure = {
      row1: [
        { label: "Date", rowSpan: 2 },
        { label: "Signups", colSpan: 2 },
      ],
      row2Labels: ["Jan 1, 2025", "Feb 1, 2025"],
    };

    expect(flattenHeaderStructureForCsv(headerStructure)).toEqual([
      "Date",
      "Signups — Jan 1, 2025",
      "Signups — Feb 1, 2025",
    ]);
  });

  it("mixes rowSpan 2 single metric columns with a ratio group", () => {
    const headerStructure: HeaderStructure = {
      row1: [
        { label: "Country", rowSpan: 2 },
        { label: "Orders", rowSpan: 2 },
        { label: "Rate", colSpan: 3 },
      ],
      row2Labels: ["Numerator", "Denominator", "Value"],
    };

    expect(flattenHeaderStructureForCsv(headerStructure)).toEqual([
      "Country",
      "Orders",
      "Rate — Numerator",
      "Rate — Denominator",
      "Rate — Value",
    ]);
  });
});
