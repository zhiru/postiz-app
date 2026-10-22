import type { Config } from 'jest';

const config: Config = {
  displayName: 'frontend',
  rootDir: '.',
  testEnvironment: 'node',
  // Existing *.spec.ts files use node:test. Keep Jest suites distinct.
  testMatch: ['<rootDir>/src/**/*.jest.spec.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/react/(.*)$':
      '<rootDir>/../../libraries/react-shared-libraries/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../../libraries/helpers/src/$1',
  },
};
export default config;
