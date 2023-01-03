/**
 * @fileoverview Maintain proper import paths
 * @author bttf
 */
"use strict";

// eslint-disable-next-line
const path = require("node:path");

const replaceWithAlias = (filePath, importDeclarationNode) => {
  const importPath = importDeclarationNode.source.value;
  const fileDirname = path.dirname(filePath);
  const packageName =
    fileDirname.indexOf("front-end") > -1 ? "front-end" : "back-end";
  const packageBasePath =
    packageName === "front-end" ? "front-end" : "back-end/src";
  const parentDirs = importPath.match(/[../]+/)[0];
  const resolvedPath = path.resolve(fileDirname, parentDirs);

  // console.log("DEBUG: ", {
  //   resolvedPath,
  //   fileDirname,
  //   parentDirs,
  //   importPath,
  // });

  let replacedPath = "";

  // ignore paths outside of package dir for now
  if (resolvedPath.indexOf(packageName) < 0) {
    replacedPath = importDeclarationNode.source.value;
  } else {
    if (resolvedPath.indexOf(packageBasePath) < 0) {
      replacedPath = importPath.replace(parentDirs, `@/${packageName}/`);
    } else {
      replacedPath = path.join(
        "@/",
        resolvedPath.substr(
          resolvedPath.indexOf(packageName) + packageBasePath.length
        ),
        importPath.substr(parentDirs.length)
      );
    }
  }

  return `"${replacedPath}"`;
};

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    messages: {
      invalidPath: "Import paths cannot exceed beyond one level up.",
    },
    type: "suggestion",
    docs: {
      description: "Maintain proper import paths",
      recommended: false,
      url: null, // URL to the documentation page for this rule
    },
    fixable: "code",
    schema: [], // Add a schema if the rule has options
  },

  create(context) {
    return {
      ImportDeclaration: function (node) {
        const importPath = node.source.value;
        const filePath = context.getPhysicalFilename();

        if (importPath.startsWith("../..")) {
          context.report({
            node,
            messageId: "invalidPath",
            fix(fixer) {
              return fixer.replaceTextRange(
                node.source.range,
                replaceWithAlias(filePath, node)
              );
            },
          });
        }
      },
    };
  },
};
