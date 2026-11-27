import { UserError } from 'n8n-workflow';

const ADDRESS_HINT = 'Enter the workspace address with https://, such as https://acme.example.com';

// A workspace address as a person types or pastes it: the scheme and
// host, then any path, query or fragment, such as a page of the
// application manager copied from the browser.
const ADDRESS = /^(https?:\/\/[^/?#\s]+)(?:[/?#].*)?$/i;

// The origin of the workspace a person entered, where the API answers.
// An address without a scheme is refused.
export function workspaceOrigin(address: unknown): string {
	const text = String(address ?? '').trim();
	const match = ADDRESS.exec(text);
	if (!match) {
		throw new UserError(`${ADDRESS_HINT} (got '${text}')`);
	}

	return match[1].toLowerCase();
}

// The same origin as an n8n expression over `reference`, such as
// `$credentials.workspaceUrl`, for the requests n8n builds itself.
// An address without a scheme passes through and fails as a URL.
export function originExpression(reference: string): string {
	return `${reference}.trim().replace(${ADDRESS}, "$1")`;
}
