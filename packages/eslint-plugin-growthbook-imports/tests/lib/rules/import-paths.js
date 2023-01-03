/**
 * @fileoverview Maintain proper import paths
 * @author bttf
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require("../../../lib/rules/import-paths"),
  RuleTester = require("eslint").RuleTester;


//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester();
ruleTester.run("import-paths", rule, {
  valid: [
    // give me some code that won't trigger a warning
  ],

  invalid: [
    {
      code: "import a from '../../../a';",
      errors: [{ message: "Fill me in.", type: "Me too" }],
    },
  ],
});
