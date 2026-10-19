import { UserError } from 'n8n-workflow';

const ADDRESS_HINT = 'Enter the workspace address only, such as https://acme.example.com';

export const CLIENT_REFUSED = 'The workspace refused the client ID or the client secret';

export const CLIENT_REFUSED_HINT =
	'Check both against the API consumer in the application manager. A regenerated secret replaces the old one, and a suspended consumer is refused.';

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

// The OAuth 2.0 client credentials grant, as the credential sends it
// before a workflow's first request and the connection test sends it.
export function tokenRequest(credentials: Record<string, unknown>) {
	const form = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: String(credentials.clientId ?? '').trim(),
		client_secret: String(credentials.clientSecret ?? ''),
	});

	return {
		method: 'POST' as const,
		url: `${workspaceOrigin(credentials.workspaceUrl)}/api/oauth/token`,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: form.toString(),
	};
}
