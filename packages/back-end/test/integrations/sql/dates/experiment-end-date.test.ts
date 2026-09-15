import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";

const ASOF = new Date("2024-02-10T12:00:00.000Z");
const PHASE_END = new Date("2999-01-01T00:00:00.000Z");

describe("getExperimentEndDate", () => {
  it("returns the phase end date when in-progress conversions are included", () => {
    expect(
      getExperimentEndDate(
        { skipPartialData: false, endDate: PHASE_END },
        96,
        ASOF,
      ),
    ).toEqual(PHASE_END);
  });

  it("subtracts conversion hours in elapsed time", () => {
    expect(
      getExperimentEndDate(
        { skipPartialData: true, endDate: PHASE_END },
        96,
        ASOF,
      ),
    ).toEqual(new Date("2024-02-06T12:00:00.000Z"));
  });

  it("subtracts a 30-minute window as 30 minutes, not a truncated hour", () => {
    expect(
      getExperimentEndDate(
        { skipPartialData: true, endDate: PHASE_END },
        0.5,
        ASOF,
      ),
    ).toEqual(new Date("2024-02-10T11:30:00.000Z"));
  });

  it("never cuts off after the phase end date", () => {
    const phaseEnd = new Date("2024-01-31T00:00:00.000Z");
    expect(
      getExperimentEndDate(
        { skipPartialData: true, endDate: phaseEnd },
        96,
        ASOF,
      ),
    ).toEqual(phaseEnd);
  });
});
