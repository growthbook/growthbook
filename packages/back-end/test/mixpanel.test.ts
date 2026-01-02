import {
  AGGREGATE_JS_FUNCTIONS,
  conditionToJavascript,
  getMixpanelPropertyColumn,
} from "back-end/src/util/mixpanel";

describe("backend", () => {
  it("detects mixpanel property columns", () => {
    expect(getMixpanelPropertyColumn("abc")).toEqual(`event.properties["abc"]`);

    expect(getMixpanelPropertyColumn("a.b.c")).toEqual(
      `event.properties["a"]["b"]["c"]`,
    );

    expect(getMixpanelPropertyColumn("a.[10].c")).toEqual(
      `event.properties["a"][10]["c"]`,
    );

    expect(getMixpanelPropertyColumn("event.time")).toEqual(`event.time`);

    expect(getMixpanelPropertyColumn("eventDays")).toEqual(
      `event.properties["eventDays"]`,
    );
  });

  it("converts conditions to javascript", () => {
    // Cast left side to string
    expect(
      conditionToJavascript({ column: "v", operator: "=", value: "true" }),
    ).toEqual(`event.properties["v"]+'' == "true"`);

    // Use number when right side is numeric
    expect(
      conditionToJavascript({ column: "v", operator: "<", value: "10" }),
    ).toEqual(`event.properties["v"]+'' < 10`);

    // Detect numbers correctly
    expect(
      conditionToJavascript({ column: "v", operator: "<", value: "10px" }),
    ).toEqual(`event.properties["v"]+'' < "10px"`);

    // Always use strings for equals
    expect(
      conditionToJavascript({ column: "v", operator: "=", value: "10" }),
    ).toEqual(`event.properties["v"]+'' == "10"`);

    // Regex
    expect(
      conditionToJavascript({ column: "v", operator: "~", value: "abc.*" }),
    ).toEqual(`(event.properties["v"]||"").match(new RegExp("abc.*"))`);

    // Negative regex
    expect(
      conditionToJavascript({ column: "v", operator: "!~", value: "abc.*" }),
    ).toEqual(`!(event.properties["v"]||"").match(new RegExp("abc.*"))`);

    // Custom javascript
    expect(
      conditionToJavascript({
        column: "event.time",
        operator: "=>",
        value: "value<5||value>10",
      }),
    ).toEqual(`((value) => (value<5||value>10))(event.time)`);
  });

  it("implements aggregate functions correctly", () => {
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.sum})([1,1,2,3,4,6])`)).toEqual(17);
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.count})([1,1,2,3,4,6])`)).toEqual(6);
    expect(
      eval(`(${AGGREGATE_JS_FUNCTIONS.countDistinct})([1,1,2,3,4,6])`),
    ).toEqual(5);
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.max})([-99,1,2,3,4,6])`)).toEqual(6);
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.min})([-99,1,2,3,4,6])`)).toEqual(
      -99,
    );
    expect(
      eval(`(() => {
      const sum=${AGGREGATE_JS_FUNCTIONS.sum};
      const count=${AGGREGATE_JS_FUNCTIONS.count};
      return (${AGGREGATE_JS_FUNCTIONS.avg})([1,6,8,5])
    })()`),
    ).toEqual(5);
    expect(
      eval(`(() => {
      const sum=${AGGREGATE_JS_FUNCTIONS.sum};
      const count=${AGGREGATE_JS_FUNCTIONS.count};
      return (${AGGREGATE_JS_FUNCTIONS.avg})([])
    })()`),
    ).toEqual(0);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],20)`,
      ),
    ).toEqual(2);
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.percentile})([5],50)`)).toEqual(5);
    expect(eval(`(${AGGREGATE_JS_FUNCTIONS.percentile})([],50)`)).toEqual(0);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],56)`,
      ),
    ).toEqual(5.6);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],0)`,
      ),
    ).toEqual(0);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],100)`,
      ),
    ).toEqual(10);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],200)`,
      ),
    ).toEqual(10);
    expect(
      eval(
        `(${AGGREGATE_JS_FUNCTIONS.percentile})([0,1,2,3,4,5,6,7,8,9,10],-10)`,
      ),
    ).toEqual(0);
    expect(
      eval(`(() => {
      const percentile=${AGGREGATE_JS_FUNCTIONS.percentile};
      return (${AGGREGATE_JS_FUNCTIONS.median})([0,1,2,3,4,5,6,7,8,9,10])
    })()`),
    ).toEqual(5);
    expect(
      eval(`(() => {
      const percentile=${AGGREGATE_JS_FUNCTIONS.percentile};
      return (${AGGREGATE_JS_FUNCTIONS.median})([0,1,2,3,4,5,6,7,8,9])
    })()`),
    ).toEqual(4.5);
  });
});
