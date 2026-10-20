import {
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
} from 'n8n-workflow';

type PropertyRow = {
	propertyTypeId?: string;
	value?: string;
};

// Leaves out what a person left empty, so an update writes only what it
// names.
export function compact(values: IDataObject): IDataObject {
	const entries = Object.entries(values).filter(([, value]) => {
		if (value === undefined || value === null || value === '') return false;
		return !(Array.isArray(value) && value.length === 0);
	});
	return Object.fromEntries(entries);
}

// Rows of a property type and a value, as `propertiesInput` takes them:
// one value per type, a list where several rows name the same type.
export function propertiesInput(rows: PropertyRow[]): IDataObject {
	const grouped: Record<string, string[]> = {};
	for (const row of rows) {
		if (!row.propertyTypeId) continue;
		const key = String(row.propertyTypeId);
		grouped[key] = [...(grouped[key] ?? []), row.value ?? ''];
	}
	const entries = Object.entries(grouped).map(([key, values]) => {
		return [key, values.length === 1 ? values[0] : values];
	});
	return Object.fromEntries(entries);
}

// A comma parts two names, except one between two digits, as the
// locants of 1,2-Hexanediol.
const NAME_COMMA = /(?<!\d),|,(?!\d)/;

// The components as `componentsInput` takes them, from the raw rows and
// what they resolve to. A row typed by hand is one name. An expression
// gives the names of the list it resolves to, or of its text: one per
// line where it has line breaks, else one between commas.
export function componentsInput(raw: unknown, resolved: unknown): unknown[] {
	const inRows = Array.isArray(raw) && Array.isArray(resolved);
	const rows = inRows ? raw : [raw];
	const values = inRows ? resolved : [resolved];
	const names = values.flatMap((value, index) => {
		const row = rows[index];
		const typed = typeof row === 'string' && !row.startsWith('=');
		if (Array.isArray(value)) return value;
		if (typeof value !== 'string' || typed) return [value];
		return value.split(value.includes('\n') ? '\n' : NAME_COMMA);
	});
	return names
		.map((name) => (typeof name === 'string' ? name.trim() : name))
		.filter((name) => name !== undefined && name !== null && name !== '');
}

export function setBody(
	requestOptions: IHttpRequestOptions,
	body: IDataObject,
): IHttpRequestOptions {
	return { ...requestOptions, body };
}

// A JSON field as an object, left out when empty. n8n hands a JSON
// parameter over as text or, from an expression, as the object itself.
export function jsonObject(
	context: IExecuteSingleFunctions,
	value: unknown,
	label: string,
): IDataObject | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			parsed = undefined;
		}
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		const message = `'${label}' must be a JSON object`;
		throw new NodeOperationError(context.getNode(), message, {
			description: 'Write the value as an object in braces, such as {"key": "value"}',
		});
	}

	return parsed as IDataObject;
}

function writeFields(context: IExecuteSingleFunctions, required: IDataObject): IDataObject {
	const operation = context.getNodeParameter('operation') as string;
	if (operation !== 'create') return context.getNodeParameter('updateFields', {}) as IDataObject;

	const additional = context.getNodeParameter('additionalFields', {}) as IDataObject;
	return { ...additional, ...required };
}

// The component write: its attributes under `component`, properties and
// templates beside it in the shape the application manager's form sends.
export async function componentBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = this.getNodeParameter('operation') as string;
	const required = operation === 'create' ? { name: this.getNodeParameter('name') } : {};
	const fields = writeFields(this, required);

	const body = compact({
		component: compact({ name: fields.name, mpn: fields.mpn }),
		properties: jsonObject(this, fields.properties, 'Properties (JSON)'),
		templateIds: fields.templateIds,
	});
	return setBody(requestOptions, body);
}

// The product write: the product's fields under `product`, the brand
// beside it, both only with what the person filled in.
export async function productBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = this.getNodeParameter('operation') as string;
	const required =
		operation === 'create'
			? {
					name: this.getNodeParameter('name'),
					brandName: this.getNodeParameter('brandName', ''),
					componentNames: this.getNodeParameter('componentNames', []),
				}
			: {};
	const fields = writeFields(this, required);
	const rows = this.getNodeParameter('properties.property', []) as PropertyRow[];
	const parameters = this.getNode().parameters;
	const written = operation === 'create' ? parameters : parameters.updateFields;
	const rawNames = (written as IDataObject | undefined)?.componentNames;

	const product = compact({
		name: fields.name,
		componentsInput: componentsInput(rawNames, fields.componentNames),
		gtin: fields.gtin,
		parentId: fields.parentId || undefined,
		categoryIds: fields.categoryIds,
		propertiesInput: rows.length > 0 ? propertiesInput(rows) : undefined,
	});
	const brand = fields.brandName ? { name: fields.brandName } : undefined;

	return setBody(requestOptions, compact({ product, brand }));
}

// A creating request sent again with the same key and body within a day
// answers the stored result instead of writing twice.
function withIdempotencyKey(
	requestOptions: IHttpRequestOptions,
	key: unknown,
): IHttpRequestOptions {
	if (!key) return requestOptions;
	const headers = { ...requestOptions.headers, 'Idempotency-Key': String(key) };
	return { ...requestOptions, headers };
}

function locatorValue(context: IExecuteSingleFunctions, name: string): string {
	return String(context.getNodeParameter(name, '', { extractValue: true }));
}

// A passport write. The identifiers follow the granularity: a batch
// passport names its lot, an item passport its lot and its serial.
export async function passportBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = this.getNodeParameter('operation') as string;
	if (operation === 'update') {
		const fields = this.getNodeParameter('updateFields', {}) as IDataObject;
		const dpp = compact({
			...fields,
			dynamicData: jsonObject(this, fields.dynamicData, 'Dynamic Data (JSON)'),
		});
		return setBody(requestOptions, { dpp });
	}

	const granularity = this.getNodeParameter('granularity', '') as string;
	const lotNamed = granularity === 'batch' || granularity === 'item';
	const additional = this.getNodeParameter('additionalFields', {}) as IDataObject;
	const dpp = compact({
		unlockableId: Number(locatorValue(this, 'product')),
		granularity,
		batchIdentifier: lotNamed ? this.getNodeParameter('batchIdentifier', '') : undefined,
		serialIdentifier:
			granularity === 'item' ? this.getNodeParameter('serialIdentifier', '') : undefined,
		description: additional.description,
		modelIdentifier: additional.modelIdentifier,
		locale: additional.locale,
		dynamicData: jsonObject(this, additional.dynamicData, 'Dynamic Data (JSON)'),
	});
	const options = setBody(requestOptions, { dpp });

	return withIdempotencyKey(options, additional.idempotencyKey);
}

export async function publishBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const fields = this.getNodeParameter('publishFields', {}) as IDataObject;
	const options = setBody(requestOptions, compact({ reason: fields.reason }));

	return withIdempotencyKey(options, fields.idempotencyKey);
}

// An event on the passport's log. Only a status change carries the
// status it moves the passport to.
export async function eventBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const eventType = this.getNodeParameter('eventType') as string;
	const fields = this.getNodeParameter('eventFields', {}) as IDataObject;
	const statusChange = eventType === 'status_change';
	const event = compact({
		eventType,
		status: statusChange ? this.getNodeParameter('status') : undefined,
		description: fields.description,
		gln: fields.gln,
		publish: fields.publish === true ? true : undefined,
		data: jsonObject(this, fields.data, 'Data (JSON)'),
	});

	return setBody(requestOptions, { event });
}

export async function dynamicDataBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const value = this.getNodeParameter('dynamicData');
	const dynamicData = jsonObject(this, value, 'Dynamic Data (JSON)') ?? {};

	return setBody(requestOptions, { dynamicData });
}

// A request to a person or an access group. The subject names one
// record the task is about, as `<type>:<id>`.
export async function taskBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const fields = this.getNodeParameter('additionalFields', {}) as IDataObject;
	const subject =
		fields.subjectType && fields.subjectId
			? `${fields.subjectType}:${fields.subjectId}`
			: undefined;
	const task = compact({
		title: this.getNodeParameter('title'),
		assigneeKey: locatorValue(this, 'assignee'),
		note: fields.note,
		dueOn: fields.dueOn ? String(fields.dueOn).slice(0, 10) : undefined,
		priority: fields.priority,
		subjectKey: subject,
	});
	const options = setBody(requestOptions, { task });

	return withIdempotencyKey(options, fields.idempotencyKey);
}

// The free-text note and, for a reissue, the successor a lifecycle
// operation carries onto its event.
export function fieldsBody(parameter: string) {
	return async function (
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const fields = this.getNodeParameter(parameter, {}) as IDataObject;
		return setBody(requestOptions, compact(fields));
	};
}
