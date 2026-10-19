import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
} from 'n8n-workflow';
import { headline } from './transport';
import { CLIENT_REFUSED, tokenRequest, workspaceOrigin } from './workspace';

type Answer = {
	statusCode: number;
	body: unknown;
};

type Identity = {
	scope?: string[];
	inactiveAccessGroups?: string[];
};

const NO_PERMISSION =
	'The API consumer holds no permission. Add it to an access group in the application manager that grants what the workflows need.';

function failed(message: string): INodeCredentialTestResult {
	return { status: 'Error', message };
}

// The failure of a request as the workspace words it, else its status.
function failure(answer: Answer): INodeCredentialTestResult {
	return failed(headline(answer.body) ?? `The workspace answered HTTP ${answer.statusCode}`);
}

// Groups that are switched off grant nothing, so a consumer whose
// only groups are off may do nothing until one is switched on.
function verdict(identity: Identity): INodeCredentialTestResult {
	if ((identity.scope ?? []).length > 0) {
		return { status: 'OK', message: 'Connection tested successfully' };
	}

	const groups = (identity.inactiveAccessGroups ?? []).map((name) => `"${name}"`);
	if (groups.length === 0) return failed(NO_PERMISSION);

	const names = groups.join(', ');
	const off =
		groups.length === 1
			? `its access group ${names} is switched off. Switch it on`
			: `its access groups ${names} are switched off. Switch them on`;
	return failed(
		`The API consumer holds no permission: ${off} in the application manager, or add the consumer to a group that grants what the workflows need.`,
	);
}

async function send(context: ICredentialTestFunctions, options: object): Promise<Answer> {
	const full = { ...options, json: true, simple: false, resolveWithFullResponse: true };
	return (await context.helpers.request(full)) as Answer;
}

// The test n8n runs when the credential is saved: the token exchange
// the nodes make, then `GET /me`, whose `scope` lists what the token
// may use. It fails while the list is empty, naming the access groups
// that are switched off, before a workflow runs into a refusal.
export async function testConnection(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};
	try {
		const token = await send(this, tokenRequest(data));
		if (token.statusCode === 401) return failed(CLIENT_REFUSED);
		if (token.statusCode >= 400) return failure(token);

		const accessToken = (token.body as { access_token?: string }).access_token;
		const me = await send(this, {
			url: `${workspaceOrigin(data.workspaceUrl)}/api/me`,
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
		});
		if (me.statusCode >= 400) return failure(me);

		return verdict(me.body as Identity);
	} catch (error) {
		return failed((error as Error).message);
	}
}

// n8n runs the test of the first node it finds using the credential,
// so every node of the package names this one under `testedBy`, as a
// literal, the form n8n's lint reads.
export const credentialTest = { transpareoApiTest: testConnection };
