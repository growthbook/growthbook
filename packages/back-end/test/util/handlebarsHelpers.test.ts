import Handlebars, { HelperOptions } from "handlebars";
import { helpers } from "../../src/util/handlebarsHelpers"; // Replace '../src/helpers' with the correct path to the helpers module.

// Register all the helpers from handlebarsHelpers
Object.keys(helpers).forEach((helperName) => {
  Handlebars.registerHelper(helperName, helpers[helperName]);
});

// Type for Handlebars compile function
type HandlebarsCompileFunction = (
  context?: Record<string, unknown>,
  options?: HelperOptions
) => string;

const compile: (
  template: string
) => HandlebarsTemplateDelegate = Handlebars.compile.bind(Handlebars);

describe("camelcase", () => {
  it("should return an empty string if undefined", () => {
    const fn = Handlebars.compile("{{camelcase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });

  it("should return the string in camelcase", () => {
    const fn = Handlebars.compile(
      '{{camelcase "foo bar baz qux"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("fooBarBazQux");
  });

  it("should lowercase a single character", () => {
    const fn1 = Handlebars.compile(
      '{{camelcase "f"}}'
    ) as HandlebarsCompileFunction;
    const fn2 = Handlebars.compile(
      '{{camelcase "A"}}'
    ) as HandlebarsCompileFunction;
    expect(fn1()).toBe("f");
    expect(fn2()).toBe("a");
  });
});

describe("dotcase", function () {
  it("should return an empty string if undefined", function () {
    const fn = Handlebars.compile("{{dotcase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });
  it("should return the string in dotcase", function () {
    const fn = Handlebars.compile(
      '{{dotcase "foo bar baz qux"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("foo.bar.baz.qux");
  });
  it("should lowercase a single character", function () {
    const fn = Handlebars.compile(
      '{{dotcase "f"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("f");

    const fn2 = Handlebars.compile(
      '{{dotcase "A"}}'
    ) as HandlebarsCompileFunction;
    expect(fn2()).toBe("a");
  });
});

describe("kebabcase", function () {
  it("should return an empty string if undefined", function () {
    const fn = compile("{{kebabcase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });

  it("should return the string in kebabcase", function () {
    const fn = compile(
      '{{kebabcase "foo bar baz qux"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("foo-bar-baz-qux");
  });

  it("should lowercase a single character", function () {
    const fn = compile('{{kebabcase "f"}}') as HandlebarsCompileFunction;
    expect(fn()).toBe("f");
    const fn2 = compile('{{kebabcase "A"}}') as HandlebarsCompileFunction;
    expect(fn2()).toBe("a");
  });
});

describe("lowercase", function () {
  it("should return an empty string if undefined", function () {
    const fn = compile("{{lowercase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });

  it("should return the string in lowercase", function () {
    const fn = compile(
      '{{lowercase "BENDER SHOULD NOT BE ALLOWED ON TV"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("bender should not be allowed on tv");
  });
});

describe("pascalcase", function () {
  it("should return an empty string if undefined", function () {
    const fn = compile("{{pascalcase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });

  it("should return the string in pascalcase", function () {
    const fn = compile(
      '{{pascalcase "foo bar baz qux"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("FooBarBazQux");
  });

  it("should uppercase a single character", function () {
    const fn1 = Handlebars.compile(
      '{{pascalcase "f"}}'
    ) as HandlebarsCompileFunction;
    const fn2 = Handlebars.compile(
      '{{pascalcase "A"}}'
    ) as HandlebarsCompileFunction;
    expect(fn1()).toBe("F");
    expect(fn2()).toBe("A");
  });
});

describe("uppercase", function () {
  it("should return an empty string if undefined", function () {
    const fn = compile("{{uppercase}}") as HandlebarsCompileFunction;
    expect(fn()).toBe("");
  });

  it("should return the string in uppercase", function () {
    const fn = compile(
      '{{uppercase "bender should not be allowed on tv"}}'
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("BENDER SHOULD NOT BE ALLOWED ON TV");
  });
});

describe("date", function () {
  it("should throw a RangeError if undefined", function () {
    const fn = compile("{{date}}") as HandlebarsCompileFunction;
    expect(() => fn()).toThrowError("");
  });

  it("should return a correctly formatted test date", function () {
    const testDate = new Date(Date.UTC(2021, 0, 5, 10, 20, 15)).toISOString();
    const fn = compile(
      `{{date '${testDate}' 'yyyy-MM-dd HH:mm:ss z'}}`
    ) as HandlebarsCompileFunction;
    expect(fn()).toBe("2021-01-05 11:20:15 UTC");
  });
});
