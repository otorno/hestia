module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "parser": "vue-eslint-parser",
    "parserOptions": {
        "parser": "@typescript-eslint/parser",
        "project": ["tsconfig.json", "tsconfig.backend.json"],
        "extraFileExtensions": [".vue"],
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint",
    ],
    "extends": [
      'plugin:vue/recommended'
    ],
    "rules": {
        "vue/html-quotes": ["warn", "single"],
        "vue/html-indent": ["warn", 2, {
          "baseIndent": 0
        }],
        "vue/singleline-html-element-content-newline": ["warn", {

          "ignores": [
            "router-link",
            "b-icon", "b-checkbox", "b-dropdown-item",
            "span", "button", "p", "pre", "a",
            "h1", "h2", "h3", "h4", "h5"
          ]
        }],
        "vue/max-attributes-per-line": ["warn", {
          "singleline": 5,
          "multiline": {
            "max": 1,
            "allowFirstLine": false
          }
        }],
        "vue/html-self-closing": [ "warn", {
          "html": {
            "normal": "never",
          }
        }],
        "@typescript-eslint/class-name-casing": "warn",
        "@typescript-eslint/consistent-type-definitions": "warn",
        "@typescript-eslint/explicit-member-accessibility": [
            "off",
            {
                "accessibility": "explicit"
            }
        ],
        "@typescript-eslint/indent": ["warn", 2],
        "@typescript-eslint/member-delimiter-style": [
            "warn",
            {
                "multiline": {
                    "delimiter": "semi",
                    "requireLast": true
                },
                "singleline": {
                    "delimiter": "semi",
                    "requireLast": false
                }
            }
        ],
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-empty-interface": "warn",
        "@typescript-eslint/no-inferrable-types": "warn",
        "@typescript-eslint/prefer-function-type": "warn",
        "@typescript-eslint/quotes": [
            "warn",
            "single"
        ],
        "@typescript-eslint/semi": [
            "warn"
        ],
        "@typescript-eslint/type-annotation-spacing": "warn",
        "@typescript-eslint/unified-signatures": "warn",
        "camelcase": "off",
        "curly": "off",
        "dot-notation": "off",
        "eol-last": "warn",
        "eqeqeq": [
            "warn",
            "smart"
        ],
        "guard-for-in": "warn",
        "id-blacklist": "off",
        "id-match": "off",
        "max-len": [
            "warn",
            {
                "code": 140
            }
        ],
        "no-bitwise": "off",
        "no-caller": "warn",
        "no-console": [
            "warn",
            {
                "allow": [
                    "log",
                    "warn",
                    "dir",
                    "timeLog",
                    "assert",
                    "clear",
                    "count",
                    "countReset",
                    "group",
                    "groupEnd",
                    "table",
                    "dirxml",
                    "error",
                    "groupCollapsed",
                    "Console",
                    "profile",
                    "profileEnd",
                    "timeStamp",
                    "context"
                ]
            }
        ],
        "no-debugger": "warn",
        "no-empty": "off",
        "no-eval": "warn",
        "no-fallthrough": "warn",
        "no-new-wrappers": "warn",
        "no-redeclare": "warn",
        "no-shadow": [
            "warn",
            {
                "hoist": "all"
            }
        ],
        "no-throw-literal": "warn",
        "no-trailing-spaces": "warn",
        "no-underscore-dangle": "off",
        "no-unused-expressions": "warn",
        "no-unused-labels": "warn",
        "no-var": "warn",
        "prefer-const": "warn",
        "radix": "off",
        "spaced-comment": "warn",
    }
};

/* "use prettier"
  "rules": {
      "import-spacing": true,
      "one-line": [
          true,
          "check-open-brace",
          "check-catch",
          "check-else",
          "check-whitespace"
      ],
      "whitespace": [
          true,
          "_check-branch",
          "check-decl",
          "check-operator",
          "check-separator",
          "check-type"
      ]
  }
*/
