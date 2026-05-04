/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/env.ts'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  testTimeout: 20000,
  // Run serially — prevents SQLite write conflicts across parallel workers
  maxWorkers: 1,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
    // Transform ESM-only packages in node_modules
    '^.+\\.js$': ['ts-jest', { diagnostics: false }],
  },
  // SQLite session store keeps an open handle; this prevents Jest from hanging
  forceExit: true,
  // Don't ignore these ESM-only node_modules — transform them too
  transformIgnorePatterns: [
    '/node_modules/(?!(@scure|@noble|@otplib))',
  ],
};
