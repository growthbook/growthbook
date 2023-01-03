# eslint-plugin-growthbook-imports

Rules around import statements in the TypeScript codebase for GrowthBook

## Installation

You'll first need to install [ESLint](https://eslint.org/):

```sh
npm i eslint --save-dev
```

Next, install `eslint-plugin-growthbook-imports`:

```sh
npm install eslint-plugin-growthbook-imports --save-dev
```

## Usage

Add `growthbook-imports` to the plugins section of your `.eslintrc` configuration file. You can omit the `eslint-plugin-` prefix:

```json
{
  "plugins": ["growthbook-imports"]
}
```

Then configure the rules you want to use under the rules section.

```json
{
  "rules": {
    "growthbook-imports/rule-name": 2
  }
}
```

## Rules

<!-- begin auto-generated rules list -->

TODO: Run eslint-doc-generator to generate the rules list.

<!-- end auto-generated rules list -->
