import {
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type INodeParameterResourceLocator,
} from 'n8n-workflow';
import { apiRequest } from '../../shared/transport';

type PassportKey = 'id' | 'code';

type Passport = {
	id: number;
	code: string;
};

// The list search names passports by code, as the webhook deliveries and
// the event feed do; By ID takes the record id.
function locatorMode(locator: INodeParameterResourceLocator): PassportKey {
	return locator.mode === 'id' ? 'id' : 'code';
}

// A passport is read by its id and published by its code. The search of
// the list matches codes partly, so only the exact code counts.
async function passportByCode(context: IExecuteSingleFunctions, code: string): Promise<Passport> {
	const qs = { term: code, per_page: 100 };
	const answer = (await apiRequest.call(context, 'GET', '/dpps', { qs })) as IDataObject;
	const passports = (answer.dpps ?? []) as Passport[];
	const passport = passports.find((candidate) => candidate.code === code);
	if (passport) return passport;

	throw new NodeOperationError(context.getNode(), `No passport has the code '${code}'`, {
		description: 'Check the code, or pick the passport from the list',
	});
}

async function passportById(context: IExecuteSingleFunctions, id: string): Promise<Passport> {
	return (await apiRequest.call(context, 'GET', `/dpps/${encodeURIComponent(id)}`)) as Passport;
}

export async function resolvePassport(
	context: IExecuteSingleFunctions,
	key: PassportKey,
): Promise<string> {
	const locator = context.getNodeParameter('passport') as INodeParameterResourceLocator;
	const value = String(locator.value ?? '').trim();
	const mode = locatorMode(locator);
	if (mode === key) return value;

	const passport =
		mode === 'code' ? await passportByCode(context, value) : await passportById(context, value);
	return String(passport[key]);
}

// The request path of a passport operation, under the id or the code the
// endpoint takes, whichever way the person named the passport.
export function passportPath(key: PassportKey, suffix = '') {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const passport = await resolvePassport(this, key);
		return { ...requestOptions, url: `/dpps/${encodeURIComponent(passport)}${suffix}` };
	};
}
