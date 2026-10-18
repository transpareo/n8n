import { UserError } from 'n8n-workflow';

const ADDRESS_HINT = 'Enter the workspace address only, such as https://acme.example.com';

// The origin of the workspace a person typed, without the slash a
// copied address often ends in. An address with a path (a page of the
// application manager pasted whole) or without a scheme is refused,
// since the API answers at the root of the workspace host only.
export function workspaceOrigin(address: unknown): string {
	const text = String(address ?? '')
		.trim()
		.replace(/\/+$/, '');
	const match = /^(https?:\/\/[^/?#\s]+)$/i.exec(text);
	if (!match) {
		throw new UserError(`${ADDRESS_HINT} (got '${text}')`);
	}

	return match[1].toLowerCase();
}

// The address and the client id a token was issued for, kept beside
// the token so a token of earlier credentials is never sent.
export function issuedFor(address: unknown, clientId: unknown): string {
	return `${workspaceOrigin(address)} ${String(clientId ?? '').trim()}`;
}
