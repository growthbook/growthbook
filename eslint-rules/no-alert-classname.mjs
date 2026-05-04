const ALERT_CLASS_REGEX = /(^|\s)alert(\s|$)/;

function hasAlertClass(value) {
  return typeof value === "string" && ALERT_CLASS_REGEX.test(value);
}

function unwrapExpression(node) {
  let current = node;

  while (current) {
    switch (current.type) {
      case "ChainExpression":
        current = current.expression;
        break;
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
        current = current.expression;
        break;
      default:
        return current;
    }
  }

  return current;
}

function isClassnamesHelperCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    (node.callee.name === "clsx" || node.callee.name === "classnames")
  );
}

function isJoinCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "join"
  );
}

function reportIfAlertString(node, rawValue, report) {
  if (hasAlertClass(rawValue)) {
    report(node);
  }
}

function inspectTemplateLiteral(node, report) {
  for (const quasi of node.quasis) {
    reportIfAlertString(quasi, quasi.value.cooked ?? quasi.value.raw, report);
  }

  for (const expression of node.expressions) {
    inspectClassValue(expression, report);
  }
}

function inspectClassnamesObjectKey(node, report) {
  const key = unwrapExpression(node);

  if (!key) return;

  switch (key.type) {
    case "Identifier":
      reportIfAlertString(key, key.name, report);
      return;
    case "Literal":
      reportIfAlertString(key, key.value, report);
      return;
    case "TemplateLiteral":
      inspectTemplateLiteral(key, report);
      return;
    default:
      inspectClassValue(key, report);
  }
}

function inspectClassnamesArgument(node, report) {
  const arg =
    node && node.type === "SpreadElement"
      ? node.argument
      : unwrapExpression(node);

  if (!arg) return;

  if (arg.type === "ObjectExpression") {
    for (const property of arg.properties) {
      if (property.type === "Property") {
        if (property.computed) {
          inspectClassValue(property.key, report);
        } else {
          inspectClassnamesObjectKey(property.key, report);
        }
      } else if (property.type === "SpreadElement") {
        inspectClassValue(property.argument, report);
      }
    }
    return;
  }

  inspectClassValue(arg, report);
}

function inspectJoinReceiver(node, report) {
  const value = unwrapExpression(node);

  if (!value) return;

  // Support array helper chains before `.join()` without inspecting unrelated
  // member-expression calls as className values.
  if (
    value.type === "CallExpression" &&
    value.callee.type === "MemberExpression"
  ) {
    inspectJoinReceiver(value.callee.object, report);
    return;
  }

  inspectClassValue(value, report);
}

function inspectClassValue(node, report) {
  const value = unwrapExpression(node);

  if (!value) return;

  switch (value.type) {
    case "Literal":
      reportIfAlertString(value, value.value, report);
      return;
    case "TemplateLiteral":
      inspectTemplateLiteral(value, report);
      return;
    case "ArrayExpression":
      for (const element of value.elements) {
        if (!element) continue;
        if (element.type === "SpreadElement") {
          inspectClassValue(element.argument, report);
        } else {
          inspectClassValue(element, report);
        }
      }
      return;
    case "BinaryExpression":
      if (value.operator === "+") {
        inspectClassValue(value.left, report);
        inspectClassValue(value.right, report);
      }
      return;
    case "ConditionalExpression":
      inspectClassValue(value.consequent, report);
      inspectClassValue(value.alternate, report);
      return;
    case "LogicalExpression":
      inspectClassValue(value.left, report);
      inspectClassValue(value.right, report);
      return;
    case "SequenceExpression":
      for (const expression of value.expressions) {
        inspectClassValue(expression, report);
      }
      return;
    case "CallExpression":
      if (isClassnamesHelperCall(value)) {
        for (const arg of value.arguments) {
          inspectClassnamesArgument(arg, report);
        }
        return;
      }

      if (isJoinCall(value)) {
        inspectJoinReceiver(value.callee.object, report);
      }
      return;
    default:
      return;
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow the alert class token in className values.",
    },
    schema: [],
    messages: {
      noAlertClassname:
        "Do not use Bootstrap `alert` classes. Use the `Callout` component from `@/ui/Callout` instead.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }

        if (!node.value) return;

        const reportedNodes = new Set();
        const report = (target) => {
          if (reportedNodes.has(target)) return;
          reportedNodes.add(target);

          context.report({
            node: target,
            messageId: "noAlertClassname",
          });
        };

        if (node.value.type === "Literal") {
          reportIfAlertString(node.value, node.value.value, report);
          return;
        }

        if (node.value.type === "JSXExpressionContainer") {
          inspectClassValue(node.value.expression, report);
        }
      },
    };
  },
};
