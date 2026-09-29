const { createDefaultEsmPreset } = require('ts-jest');

module.exports = {
  ...createDefaultEsmPreset({ tsconfig: 'tsconfig.test.json' }),
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
};
