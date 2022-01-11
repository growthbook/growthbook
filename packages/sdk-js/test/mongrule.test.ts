/* eslint-disable @typescript-eslint/no-explicit-any */

import { evalCondition } from "../src/mongrule";
import cases from "./cases/mongrule.json";

// 5th optional array element specifies if a debug error is expected or not
type CasesArray =
  | [string, boolean, any, any]
  | [string, boolean, any, any, boolean];

describe("condition", () => {
  it.each(cases as CasesArray)(
    "%#. %s",
    (name, expected, condition, value, expectError = false) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();
      expect(evalCondition(condition, value)).toEqual(expected);
      expect(consoleErrorMock).toHaveBeenCalledTimes(expectError ? 1 : 0);
      consoleErrorMock.mockRestore();
    }
  );
});
