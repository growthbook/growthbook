import { evalCondition } from "../src/mongrule";

describe("condition", () => {
  it("supports $not", () => {
    const condition = {
      $not: {
        name: "hello",
      },
    };

    expect(evalCondition({ name: "hello" }, condition)).toEqual(false);
    expect(evalCondition({ name: "world" }, condition)).toEqual(true);
  });

  it("supports $and and $or", () => {
    const condition = {
      $and: [
        {
          "father.age": { $gt: 65 },
        },
        {
          $or: [{ bday: { $regex: "-12-25$" } }, { name: "santa" }],
        },
      ],
    };

    // All true
    expect(
      evalCondition(
        {
          name: "santa",
          bday: "1980-12-25",
          father: {
            age: 70,
          },
        },
        condition
      )
    ).toEqual(true);

    // First and condition false
    expect(
      evalCondition(
        {
          name: "santa",
          bday: "1980-12-25",
          father: {
            age: 65,
          },
        },
        condition
      )
    ).toEqual(false);

    // First or condition false
    expect(
      evalCondition(
        {
          name: "santa",
          bday: "1980-12-20",
          father: {
            age: 70,
          },
        },
        condition
      )
    ).toEqual(true);

    // Second or condition false
    expect(
      evalCondition(
        {
          name: "barbara",
          bday: "1980-12-25",
          father: {
            age: 70,
          },
        },
        condition
      )
    ).toEqual(true);

    // Both or conditions false
    expect(
      evalCondition(
        {
          name: "barbara",
          bday: "1980-11-25",
          father: {
            age: 70,
          },
        },
        condition
      )
    ).toEqual(false);

    // All false
    expect(
      evalCondition(
        {
          name: "john smith",
          bday: "1956-12-20",
          father: {
            age: 40,
          },
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $exists operator", () => {
    const condition = {
      "pets.dog.name": {
        $exists: false,
      },
    };

    expect(evalCondition({ hello: "world" }, condition)).toEqual(true);
    expect(
      evalCondition({ pets: { dog: { name: "fido" } } }, condition)
    ).toEqual(false);

    const condition2 = {
      "pets.dog.name": {
        $exists: true,
      },
    };
    expect(evalCondition({ hello: "world" }, condition2)).toEqual(false);
    expect(
      evalCondition({ pets: { dog: { name: "fido" } } }, condition2)
    ).toEqual(true);
  });

  it("supports multiple data types for equals", () => {
    const condition = {
      str: "str",
      num: 10,
      flag: false,
    };

    expect(
      evalCondition(
        {
          str: "str",
          num: 10,
          flag: false,
        },
        condition
      )
    ).toEqual(true);
  });

  it("supports $eq, $ne, and $regex operators", () => {
    const condition = {
      occupation: {
        $eq: "engineer",
      },
      level: {
        $ne: "senior",
      },
      userAgent: {
        $regex: "(Mobile|Tablet)",
      },
    };

    expect(
      evalCondition(
        {
          occupation: "engineer",
          level: "junior",
          userAgent: "Android Tablet Browser",
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          occupation: "civil engineer",
          level: "junior",
          userAgent: "Android Tablet Browser",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          occupation: "engineer",
          level: "senior",
          userAgent: "Android Tablet Browser",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          occupation: "engineer",
          level: "junior",
          userAgent: "Mozilla Desktop Browser",
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $gt, $gte, $lt, and $lte operators for numbers", () => {
    const condition = {
      age: {
        $gt: 30,
        $lt: 60,
      },
      weight: {
        $gte: 100,
        $lte: 200,
      },
    };

    expect(
      evalCondition(
        {
          age: 50,
          weight: 100,
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          age: 30,
          weight: 100,
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          age: 29,
          weight: 100,
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          age: 60,
          weight: 100,
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          age: 61,
          weight: 100,
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          age: 31,
          weight: 150,
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          age: 31,
          weight: 200,
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          age: 31,
          weight: 201,
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          age: 31,
          weight: 99,
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $gt, $lt operators for strings", () => {
    const condition = {
      word: {
        $gt: "alphabet",
        $lt: "zebra",
      },
    };

    expect(
      evalCondition(
        {
          word: "alphabet",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          word: "zebra",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          word: "always",
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          word: "yoga",
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          word: "ABC",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          word: "AZL",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          word: "ZAL",
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $in operator", () => {
    const condition = {
      num: {
        $in: [1, 2, 3],
      },
    };
    expect(evalCondition({ num: 2 }, condition)).toEqual(true);
    expect(evalCondition({ num: 4 }, condition)).toEqual(false);
  });

  it("supports $nin operator", () => {
    const condition = {
      num: {
        $nin: [1, 2, 3],
      },
    };
    expect(evalCondition({ num: 2 }, condition)).toEqual(false);
    expect(evalCondition({ num: 4 }, condition)).toEqual(true);
  });

  it("supports $size operator", () => {
    const condition = {
      tags: {
        $size: 3,
      },
    };
    expect(evalCondition({ tags: ["a", "b"] }, condition)).toEqual(false);
    expect(evalCondition({ tags: ["a", "b", "c"] }, condition)).toEqual(true);
    expect(evalCondition({ tags: ["a", "b", "c", "d"] }, condition)).toEqual(
      false
    );
    expect(evalCondition({ tags: "abcd" }, condition)).toEqual(false);

    const condition2 = {
      tags: {
        $size: {
          $gt: 2,
        },
      },
    };
    expect(evalCondition({ tags: ["a", "b"] }, condition2)).toEqual(false);
    expect(evalCondition({ tags: ["a", "b", "c"] }, condition2)).toEqual(true);
    expect(evalCondition({ tags: ["a", "b", "c", "d"] }, condition2)).toEqual(
      true
    );
  });

  it("supports $elemMatch operator for flat arrays", () => {
    const condition = {
      nums: {
        $elemMatch: {
          $gt: 10,
        },
      },
    };
    expect(evalCondition({ nums: [0, 5, -20, 15] }, condition)).toEqual(true);
    expect(evalCondition({ nums: [0, 5, -20, 8] }, condition)).toEqual(false);
  });

  it("supports $elemMatch operator for nested objects", () => {
    const condition = {
      hobbies: {
        $elemMatch: {
          name: {
            $regex: "^ping",
          },
        },
      },
    };

    expect(
      evalCondition(
        {
          hobbies: [
            {
              name: "bowling",
            },
            {
              name: "pingpong",
            },
            {
              name: "tennis",
            },
          ],
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          hobbies: [
            {
              name: "bowling",
            },
            {
              name: "tennis",
            },
          ],
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          hobbies: "all",
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $type operator", () => {
    const types = {
      string: "a",
      undefined: undefined,
      null: null,
      boolean: false,
      number: 56,
      object: { hello: "world" },
      array: [1, 2, 3],
    };

    for (const k of Object.keys(types)) {
      const condition = {
        a: {
          $type: k,
        },
      };
      for (const [k2, v2] of Object.entries(types)) {
        expect(evalCondition({ a: v2 }, condition)).toEqual(k2 === k);
      }
    }
  });

  it("returns false for unknown $types", () => {
    const condition = {
      a: {
        $type: "string",
      },
    };
    expect(
      evalCondition(
        {
          a: Symbol(),
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $not as an operator", () => {
    const condition = {
      name: {
        $not: {
          $regex: "^hello",
        },
      },
    };

    expect(
      evalCondition(
        {
          name: "world",
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          name: "hello world",
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $all operator", () => {
    const condition = {
      tags: {
        $all: ["one", "three"],
      },
    };

    expect(
      evalCondition(
        {
          tags: "hello",
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          tags: ["one", "two", "three"],
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          tags: ["one", "two", "four"],
        },
        condition
      )
    ).toEqual(false);
  });

  it("supports $nor operator", () => {
    const condition = {
      $nor: [
        {
          name: "john",
        },
        {
          age: {
            $lt: 30,
          },
        },
      ],
    };
    expect(evalCondition({ name: "john", age: 20 }, condition)).toEqual(false);
    expect(evalCondition({ name: "john", age: 40 }, condition)).toEqual(false);
    expect(evalCondition({ name: "jim", age: 20 }, condition)).toEqual(false);
    expect(evalCondition({ name: "jim", age: 40 }, condition)).toEqual(true);
  });

  it("compares arrays directly", () => {
    const condition = {
      tags: ["hello", "world"],
    };

    expect(
      evalCondition(
        {
          tags: ["hello", "world"],
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          tags: ["world", "hello"],
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          tags: "yes",
        },
        condition
      )
    ).toEqual(false);
  });

  it("compares objects directly", () => {
    const condition = {
      tags: { hello: "world" },
    };

    expect(
      evalCondition(
        {
          tags: { hello: "world" },
        },
        condition
      )
    ).toEqual(true);

    expect(
      evalCondition(
        {
          tags: { hello: "world", yes: "please" },
        },
        condition
      )
    ).toEqual(false);

    expect(
      evalCondition(
        {
          tags: "hello world",
        },
        condition
      )
    ).toEqual(false);
  });

  it("returns false on missing source properties", () => {
    const condition = {
      "pets.dog.name": {
        $in: ["fido"],
      },
    };

    expect(evalCondition({ hello: "world" }, condition)).toEqual(false);
  });

  it("returns true on empty $or condition", () => {
    const condition = {
      $or: [],
    };
    expect(evalCondition({ hello: "world" }, condition)).toEqual(true);
  });

  it("returns true on empty $and condition", () => {
    const condition = {
      $and: [],
    };
    expect(evalCondition({ hello: "world" }, condition)).toEqual(true);
  });

  it("returns true on empty conditionset", () => {
    const condition = {};
    expect(evalCondition({ hello: "world" }, condition)).toEqual(true);
  });

  it("returns false on unknown operator", () => {
    // eslint-disable-next-line
    const r: any = {
      name: {
        $regx: "hello",
      },
    };
    const consoleErrorMock = jest.spyOn(console, "error").mockImplementation();

    const condition = r;
    expect(evalCondition({ name: "hello" }, condition)).toEqual(false);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);

    consoleErrorMock.mockRestore();
  });

  it("returns false for invalid regex", () => {
    const condition = {
      name: {
        $regex: "/???***[)",
      },
    };
    expect(evalCondition({ name: "hello" }, condition)).toEqual(false);
    expect(evalCondition({ hello: "hello" }, condition)).toEqual(false);
  });
});
