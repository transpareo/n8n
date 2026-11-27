import { describe, expect, it } from 'vitest';
import { workspaceOrigin } from '../nodes/shared/workspace';

describe('the workspace address', () => {
	it('is the origin of what was typed, without the trailing slash', () => {
		expect(workspaceOrigin(' https://Acme.example.com/ ')).toBe('https://acme.example.com');
	});

	it('is the origin of a page of the workspace pasted whole', () => {
		const page = 'https://acme.example.com/en/admin/api_consumers?page=2#list';
		expect(workspaceOrigin(page)).toBe('https://acme.example.com');
	});

	it('keeps a port', () => {
		expect(workspaceOrigin('http://localhost:3000/en')).toBe('http://localhost:3000');
	});

	it('is refused without a scheme', () => {
		expect(() => workspaceOrigin('acme.example.com')).toThrow(
			'Enter the workspace address with https://, such as https://acme.example.com',
		);
	});
});
