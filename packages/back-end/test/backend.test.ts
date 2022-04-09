import { replaceDateVars } from "../src/integrations/SqlIntegration";
import { checkSrm } from "../src/services/stats";

describe("backend", () => {
  it("replaces vars in SQL", () => {
    const start = new Date(Date.UTC(2021, 0, 5, 10, 20, 15));
    const end = new Date(Date.UTC(2022, 1, 9, 11, 30, 12));

    expect(
      replaceDateVars(
        `SELECT '{{ startDate }}' as full, '{{startYear}}' as year, '{{ startMonth}}' as month, '{{startDay }}' as day`,
        start,
        end
      )
    ).toEqual(
      "SELECT '2021-01-05 10:20:15' as full, '2021' as year, '01' as month, '05' as day"
    );

    expect(replaceDateVars(`SELECT {{ unknown }}`, start, end)).toEqual(
      "SELECT {{ unknown }}"
    );

    expect(
      replaceDateVars(
        `SELECT '{{ endDate }}' as full, '{{endYear}}' as year, '{{ endMonth}}' as month, '{{endDay }}' as day`,
        start,
        end
      )
    ).toEqual(
      "SELECT '2022-02-09 11:30:12' as full, '2022' as year, '02' as month, '09' as day"
    );
  });

  it("calculates SRM correctly", () => {
    // Simple 2-way test
    expect(+checkSrm([1000, 1200], [0.5, 0.5]).toFixed(9)).toEqual(0.000020079);

    // Another 2-way test
    expect(+checkSrm([135, 115], [0.5, 0.5]).toFixed(9)).toEqual(0.205903211);

    // Uneven weights
    expect(+checkSrm([310, 98], [0.75, 0.25]).toFixed(9)).toEqual(0.647434186);

    // Not enough valid variations
    expect(+checkSrm([1000, 0], [0.5, 0.5])).toEqual(1);

    // Not enough valid weights
    expect(+checkSrm([1000, 900, 800], [1, 0, 0])).toEqual(1);

    // Skip empty weights
    expect(+checkSrm([1000, 1200, 900], [0.5, 0.5, 0]).toFixed(9)).toEqual(
      0.000020079
    );

    // Skip empty users
    expect(+checkSrm([0, 505, 500], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.874677381
    );

    // More than 2 variations
    expect(+checkSrm([500, 500, 600], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.000592638
    );

    // Completely equal
    expect(+checkSrm([500, 500], [0.5, 0.5]).toFixed(9)).toEqual(1);
  });
});
