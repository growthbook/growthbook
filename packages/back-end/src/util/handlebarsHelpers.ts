import Handlebars from "handlebars";

// Adapted from https://github.com/helpers/handlebars-helpers
import formatInTimeZone from "date-fns-tz/formatInTimeZone";
import parseISO from "date-fns/parseISO";
export const helpers: Record<string, Handlebars.HelperDelegate> = {};

const isString = function (str: string) {
  return typeof str === "string";
};

const identity = function (val: string) {
  return val;
};

/**
 * Remove leading and trailing whitespace and non-word
 * characters from the given string.
 *
 * @param {String} `str`
 * @return {String}
 */

const chop = function (str: string) {
  if (!isString(str)) return "";
  const re = /^[-_.\W\s]+|[-_.\W\s]+$/g;
  return str.trim().replace(re, "");
};

/**
 * Change casing on the given `string`, optionally
 * passing a delimiter function to use between words
 * in the returned string.
 *
 * ```handlebars
 * utils.changecase('fooBarBaz');
 * //=> 'foo bar baz'
 *
 * utils.changecase('fooBarBaz', function(ch){ return "-" + ch.toLowerCase(); });
 * //=> 'foo-bar-baz'
 * ```
 * @param {String} `string` The string to change.
 * @return {String}
 * @api public
 */

const changecase = function (str: string, fn: (arg: string) => string) {
  if (!isString(str)) return "";
  if (str.length === 1) {
    return str.toLowerCase();
  }

  str = chop(str).toLowerCase();
  if (typeof fn !== "function") {
    fn = identity;
  }

  const re = /[-_.\W\s]+(\w|$)/g;
  return str.replace(re, function (_, ch) {
    return fn(ch);
  });
};

/**
 * camelCase the characters in the given `string`.
 *
 * ```handlebars
 * {{camelcase "foo bar baz"}};
 * <!-- results in:  'fooBarBaz' -->
 * ```
 * @param {String} `string` The string to camelcase.
 * @return {String}
 * @api public
 */

helpers.camelcase = function (str: string) {
  if (!isString(str)) return "";
  return changecase(str, function (ch: string) {
    return ch.toUpperCase();
  });
};

/**
 * dot.case the characters in `string`.
 *
 * ```handlebars
 * {{dotcase "a-b-c d_e"}}
 * <!-- results in:  'a.b.c.d.e' -->
 * ```
 * @param {String} `string`
 * @return {String}
 * @api public
 */

helpers.dotcase = function (str: string) {
  if (!isString(str)) return "";
  return changecase(str, function (ch: string) {
    return "." + ch;
  });
};

/**
 * kebab-case the characters in `string`. Replaces non-word
 * characters and periods with hyphens.
 *
 * ```handlebars
 * {{dashcase "a-b-c d_e"}}
 * <!-- results in:  'a-b-c-d-e' -->
 * ```
 * @param {String} `string`
 * @return {String}
 * @api public
 */

helpers.kebabcase = function (str: string) {
  if (!isString(str)) return "";
  return changecase(str, function (ch: string) {
    return "-" + ch;
  });
};

/**
 * Lowercase all characters in the given string.
 *
 * ```handlebars
 * {{lowercase "Foo BAR baZ"}}
 * <!-- results in:  'foo bar baz' -->
 * ```
 * @param {String} `str`
 * @return {String}
 * @api public
 */

helpers.lowercase = function (str: string) {
  if (!isString(str)) return "";
  return str.toLowerCase();
};

/**
 * PascalCase the characters in `string`.
 *
 * ```handlebars
 * {{pascalcase "foo bar baz"}}
 * <!-- results in:  'FooBarBaz' -->
 * ```
 * @param {String} `string`
 * @return {String}
 * @api public
 */

helpers.pascalcase = function (str: string) {
  if (!isString(str)) return "";
  str = changecase(str, function (ch: string) {
    return ch.toUpperCase();
  });
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * replace the characters in the given `string` that match a regular expression with the given replacement.
 *
 * ```handlebars
 * {{replace "a-b-c d_e" "[^a-z]" ""}}
 * <!-- results in:  'abcde' -->
 * ```
 * @param {String} `string`
 * @param {String} `pattern` The pattern to replace.
 * @param {String} `replacement` The replacement for `pattern`.
 * @return {String}
 * @api public
 */
helpers.replace = function (str: string, pattern: string, replacement: string) {
  return str.replace(new RegExp(pattern, "g"), replacement);
};

/**
 * snake_case the characters in the given `string`.
 *
 * ```handlebars
 * {{snakecase "a-b-c d_e"}}
 * <!-- results in:  'a_b_c_d_e' -->
 * ```
 * @param {String} `string`
 * @return {String}
 * @api public
 */

helpers.snakecase = function (str) {
  if (!isString(str)) return "";
  return changecase(str, function (ch) {
    return "_" + ch;
  });
};

/**
 * Uppercase all of the characters in the given string. Alias for [uppercase](#uppercase).
 *
 * ```handlebars
 * {{upcase "aBcDeF"}}
 * <!-- results in:  'ABCDEF' -->
 * ```
 * @param {String} `string`
 * @return {String}
 * @alias uppercase
 * @api public
 */

helpers.uppercase = function (str: string) {
  if (!isString(str)) return "";
  return str.toUpperCase();
};

/**
 * Takes an ISO date string and returns a formatted date string in the given format in UTC time.
 *
 * @param dateStr
 * @param formatStr
 * @returns
 */
helpers.date = function (dateStr: string, formatStr: string) {
  // Convert to UTC as that is what most DBs store
  return formatInTimeZone(parseISO(dateStr), "UTC", formatStr);
};
