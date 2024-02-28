import md5 from "md5";
import { parseSnapshotDimension } from "@/services/track";

describe("tracking dimension parser", () => {
  it("works for different input strings", () => {
    expect(parseSnapshotDimension("")).toEqual({ type: "none", id: "" });
    expect(parseSnapshotDimension("pre:date")).toEqual({
      type: "predefined",
      id: "date",
    });
    expect(parseSnapshotDimension("exp:aWeirdExp:Dim")).toEqual({
      type: "experiment",
      id: md5("aWeirdExp:Dim"),
    });
    expect(parseSnapshotDimension("simpleDim")).toEqual({
      type: "user",
      id: md5("simpleDim"),
    });
    expect(parseSnapshotDimension("aWeirdUser:Dim")).toEqual({
      type: "user",
      id: md5("aWeirdUser:Dim"),
    });
  });
});
