const base = require('./jest.base.cjs');

module.exports = {
  ...base,
  rootDir: '../src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};
