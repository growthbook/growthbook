import { replaceDateVars } from "../src/integrations/SqlIntegration";

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
});
