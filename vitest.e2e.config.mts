import { defineConfig } from 'vitest/config';

// The workspace and the consumer the checks run against, handed to the
// tests by name so the test code itself reads no environment.
const workspace = {
	host: process.env.TRANSPAREO_TEST_HOST ?? '',
	clientId: process.env.TRANSPAREO_TEST_CLIENT_ID ?? '',
	clientSecret: process.env.TRANSPAREO_TEST_CLIENT_SECRET ?? '',
};

export default defineConfig({
	test: {
		include: ['test/e2e/*.test.ts'],
		testTimeout: 60_000,
		fileParallelism: false,
		provide: { workspace },
	},
});
