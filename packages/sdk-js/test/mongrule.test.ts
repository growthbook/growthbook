import { Condition } from "../src/mongrule";

describe("condition", () => {
  it("supports $not", () => {
    const condition = new Condition({
      $not: {
        name: "hello",
      },
    });

    expect(condition.test({ name: "hello" })).toEqual(false);
    expect(condition.test({ name: "world" })).toEqual(true);
  });

  it("supports $and and $or", () => {
    const condition = new Condition({
      $and: [
        {
          "father.age": { $gt: 65 },
        },
        {
          $or: [{ bday: { $regex: "-12-25$" } }, { name: "santa" }],
        },
      ],
    });

    // All true
    expect(
      condition.test({
        name: "santa",
        bday: "1980-12-25",
        father: {
          age: 70,
        },
      })
    ).toEqual(true);

    // First and condition false
    expect(
      condition.test({
        name: "santa",
        bday: "1980-12-25",
        father: {
          age: 65,
        },
      })
    ).toEqual(false);

    // First or condition false
    expect(
      condition.test({
        name: "santa",
        bday: "1980-12-20",
        father: {
          age: 70,
        },
      })
    ).toEqual(true);

    // Second or condition false
    expect(
      condition.test({
        name: "barbara",
        bday: "1980-12-25",
        father: {
          age: 70,
        },
      })
    ).toEqual(true);

    // Both or conditions false
    expect(
      condition.test({
        name: "barbara",
        bday: "1980-11-25",
        father: {
          age: 70,
        },
      })
    ).toEqual(false);

    // All false
    expect(
      condition.test({
        name: "john smith",
        bday: "1956-12-20",
        father: {
          age: 40,
        },
      })
    ).toEqual(false);
  });

  it("supports $exists operator", () => {
    const condition = new Condition({
      "pets.dog.name": {
        $exists: false,
      },
    });

    expect(condition.test({ hello: "world" })).toEqual(true);
    expect(condition.test({ pets: { dog: { name: "fido" } } })).toEqual(false);

    const condition2 = new Condition({
      "pets.dog.name": {
        $exists: true,
      },
    });
    expect(condition2.test({ hello: "world" })).toEqual(false);
    expect(condition2.test({ pets: { dog: { name: "fido" } } })).toEqual(true);
  });

  it("supports multiple data types for equals", () => {
    const condition = new Condition({
      str: "str",
      num: 10,
      flag: false,
    });

    expect(
      condition.test({
        str: "str",
        num: 10,
        flag: false,
      })
    ).toEqual(true);
  });

  it("supports $eq, $ne, and $regex operators", () => {
    const condition = new Condition({
      occupation: {
        $eq: "engineer",
      },
      level: {
        $ne: "senior",
      },
      userAgent: {
        $regex: "(Mobile|Tablet)",
      },
    });

    expect(
      condition.test({
        occupation: "engineer",
        level: "junior",
        userAgent: "Android Tablet Browser",
      })
    ).toEqual(true);

    expect(
      condition.test({
        occupation: "civil engineer",
        level: "junior",
        userAgent: "Android Tablet Browser",
      })
    ).toEqual(false);

    expect(
      condition.test({
        occupation: "engineer",
        level: "senior",
        userAgent: "Android Tablet Browser",
      })
    ).toEqual(false);

    expect(
      condition.test({
        occupation: "engineer",
        level: "junior",
        userAgent: "Mozilla Desktop Browser",
      })
    ).toEqual(false);
  });

  it("supports $gt, $gte, $lt, and $lte operators for numbers", () => {
    const condition = new Condition({
      age: {
        $gt: 30,
        $lt: 60,
      },
      weight: {
        $gte: 100,
        $lte: 200,
      },
    });

    expect(
      condition.test({
        age: 50,
        weight: 100,
      })
    ).toEqual(true);

    expect(
      condition.test({
        age: 30,
        weight: 100,
      })
    ).toEqual(false);

    expect(
      condition.test({
        age: 29,
        weight: 100,
      })
    ).toEqual(false);

    expect(
      condition.test({
        age: 60,
        weight: 100,
      })
    ).toEqual(false);

    expect(
      condition.test({
        age: 61,
        weight: 100,
      })
    ).toEqual(false);

    expect(
      condition.test({
        age: 31,
        weight: 150,
      })
    ).toEqual(true);

    expect(
      condition.test({
        age: 31,
        weight: 200,
      })
    ).toEqual(true);

    expect(
      condition.test({
        age: 31,
        weight: 201,
      })
    ).toEqual(false);

    expect(
      condition.test({
        age: 31,
        weight: 99,
      })
    ).toEqual(false);
  });

  it("supports $gt, $lt operators for strings", () => {
    const condition = new Condition({
      word: {
        $gt: "alphabet",
        $lt: "zebra",
      },
    });

    expect(
      condition.test({
        word: "alphabet",
      })
    ).toEqual(false);

    expect(
      condition.test({
        word: "zebra",
      })
    ).toEqual(false);

    expect(
      condition.test({
        word: "always",
      })
    ).toEqual(true);

    expect(
      condition.test({
        word: "yoga",
      })
    ).toEqual(true);

    expect(
      condition.test({
        word: "ABC",
      })
    ).toEqual(false);

    expect(
      condition.test({
        word: "AZL",
      })
    ).toEqual(false);

    expect(
      condition.test({
        word: "ZAL",
      })
    ).toEqual(false);
  });

  it("supports $in operator", () => {
    const condition = new Condition({
      num: {
        $in: [1, 2, 3],
      },
    });
    expect(condition.test({ num: 2 })).toEqual(true);
    expect(condition.test({ num: 4 })).toEqual(false);
  });

  it("supports $nin operator", () => {
    const condition = new Condition({
      num: {
        $nin: [1, 2, 3],
      },
    });
    expect(condition.test({ num: 2 })).toEqual(false);
    expect(condition.test({ num: 4 })).toEqual(true);
  });

  it("supports $size operator", () => {
    const condition = new Condition({
      tags: {
        $size: 3,
      },
    });
    expect(condition.test({ tags: ["a", "b"] })).toEqual(false);
    expect(condition.test({ tags: ["a", "b", "c"] })).toEqual(true);
    expect(condition.test({ tags: ["a", "b", "c", "d"] })).toEqual(false);
    expect(condition.test({ tags: "abcd" })).toEqual(false);

    const condition2 = new Condition({
      tags: {
        $size: {
          $gt: 2,
        },
      },
    });
    expect(condition2.test({ tags: ["a", "b"] })).toEqual(false);
    expect(condition2.test({ tags: ["a", "b", "c"] })).toEqual(true);
    expect(condition2.test({ tags: ["a", "b", "c", "d"] })).toEqual(true);
  });

  it("supports $elemMatch operator for flat arrays", () => {
    const condition = new Condition({
      nums: {
        $elemMatch: {
          $gt: 10,
        },
      },
    });
    expect(condition.test({ nums: [0, 5, -20, 15] })).toEqual(true);
    expect(condition.test({ nums: [0, 5, -20, 8] })).toEqual(false);
  });

  it("supports $elemMatch operator for nested objects", () => {
    const condition = new Condition({
      hobbies: {
        $elemMatch: {
          name: {
            $regex: "^ping",
          },
        },
      },
    });

    expect(
      condition.test({
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
      })
    ).toEqual(true);

    expect(
      condition.test({
        hobbies: [
          {
            name: "bowling",
          },
          {
            name: "tennis",
          },
        ],
      })
    ).toEqual(false);

    expect(
      condition.test({
        hobbies: "all",
      })
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
      const condition = new Condition({
        a: {
          $type: k,
        },
      });
      for (const [k2, v2] of Object.entries(types)) {
        expect(condition.test({ a: v2 })).toEqual(k2 === k);
      }
    }
  });

  it("returns false for unknown $types", () => {
    const condition = new Condition({
      a: {
        $type: "string",
      },
    });
    expect(
      condition.test({
        a: Symbol(),
      })
    ).toEqual(false);
  });

  it("supports $not as an operator", () => {
    const condition = new Condition({
      name: {
        $not: {
          $regex: "^hello",
        },
      },
    });

    expect(
      condition.test({
        name: "world",
      })
    ).toEqual(true);

    expect(
      condition.test({
        name: "hello world",
      })
    ).toEqual(false);
  });

  it("supports $all operator", () => {
    const condition = new Condition({
      tags: {
        $all: ["one", "three"],
      },
    });

    expect(
      condition.test({
        tags: "hello",
      })
    ).toEqual(false);

    expect(
      condition.test({
        tags: ["one", "two", "three"],
      })
    ).toEqual(true);

    expect(
      condition.test({
        tags: ["one", "two", "four"],
      })
    ).toEqual(false);
  });

  it("supports $nor operator", () => {
    const condition = new Condition({
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
    });
    expect(condition.test({ name: "john", age: 20 })).toEqual(false);
    expect(condition.test({ name: "john", age: 40 })).toEqual(false);
    expect(condition.test({ name: "jim", age: 20 })).toEqual(false);
    expect(condition.test({ name: "jim", age: 40 })).toEqual(true);
  });

  it("compares arrays directly", () => {
    const condition = new Condition({
      tags: ["hello", "world"],
    });

    expect(
      condition.test({
        tags: ["hello", "world"],
      })
    ).toEqual(true);

    expect(
      condition.test({
        tags: ["world", "hello"],
      })
    ).toEqual(false);

    expect(
      condition.test({
        tags: "yes",
      })
    ).toEqual(false);
  });

  it("compares objects directly", () => {
    const condition = new Condition({
      tags: { hello: "world" },
    });

    expect(
      condition.test({
        tags: { hello: "world" },
      })
    ).toEqual(true);

    expect(
      condition.test({
        tags: { hello: "world", yes: "please" },
      })
    ).toEqual(false);

    expect(
      condition.test({
        tags: "hello world",
      })
    ).toEqual(false);
  });

  it("returns false on missing source properties", () => {
    const condition = new Condition({
      "pets.dog.name": {
        $in: ["fido"],
      },
    });

    expect(condition.test({ hello: "world" })).toEqual(false);
  });

  it("returns true on empty $or condition", () => {
    const condition = new Condition({
      $or: [],
    });
    expect(condition.test({ hello: "world" })).toEqual(true);
  });

  it("returns true on empty $and condition", () => {
    const condition = new Condition({
      $and: [],
    });
    expect(condition.test({ hello: "world" })).toEqual(true);
  });

  it("returns true on empty conditionset", () => {
    const condition = new Condition({});
    expect(condition.test({ hello: "world" })).toEqual(true);
  });

  it("returns false on unknown operator", () => {
    // eslint-disable-next-line
    const r: any = {
      name: {
        $regx: "hello",
      },
    };
    const consoleErrorMock = jest.spyOn(console, "error").mockImplementation();

    const condition = new Condition(r);
    expect(condition.test({ name: "hello" })).toEqual(false);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);

    consoleErrorMock.mockRestore();
  });

  it("returns false for invalid regex", () => {
    const condition = new Condition({
      name: {
        $regex: "/???***[)",
      },
    });
    expect(condition.test({ name: "hello" })).toEqual(false);
    expect(condition.test({ hello: "hello" })).toEqual(false);
  });
});
