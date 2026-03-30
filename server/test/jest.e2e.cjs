const base = require('./jest.base.cjs');

module.exports = {
  ...base,
  rootDir: '..',
  testRegex: '.e2e-spec.ts$',
};
