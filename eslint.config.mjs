// Security-focused static analysis for the browser code in site/*.js.
// Only rules that guard against injection and dynamic code execution are enabled:
// remote data (the validator's JSON) must reach the page through textContent / DOM
// APIs, never as HTML. Style rules are intentionally left out.
export default [
  {
    files: ['site/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use textContent or DOM APIs: the data comes from a remote service.' },
        { property: 'outerHTML', message: 'Use DOM APIs: the data comes from a remote service.' },
        { property: 'insertAdjacentHTML', message: 'Use DOM APIs: the data comes from a remote service.' },
        { object: 'document', property: 'write', message: 'document.write is not allowed.' },
        { object: 'document', property: 'writeln', message: 'document.writeln is not allowed.' },
      ],
    },
  },
];
