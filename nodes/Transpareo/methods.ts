import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { apiRequest } from '../shared/transport';

const PAGE_SIZE = 50;

type Record = IDataObject & { id: number };

type Category = {
	id: number;
	name: string;
	categories?: Category[];
};

// One page of a list as list-search results, with the next page as the
// token while the page came back full.
async function searchPage(
	context: ILoadOptionsFunctions,
	path: string,
	rootProperty: string,
	query: IDataObject,
	paginationToken: string | undefined,
	toItem: (record: Record) => INodeListSearchItems,
): Promise<INodeListSearchResult> {
	const page = paginationToken ? Number(paginationToken) : 1;
	const qs = { ...query, per_page: PAGE_SIZE, page };
	const answer = (await apiRequest.call(context, 'GET', path, { qs })) as IDataObject;
	const records = (answer[rootProperty] ?? []) as Record[];

	const results = records.map(toItem);
	const next = records.length === PAGE_SIZE ? String(page + 1) : undefined;
	return { results, paginationToken: next };
}

function byName(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name);
}

function categoryOptions(categories: Category[], parent?: string): INodePropertyOptions[] {
	return categories.flatMap((category) => {
		const name = parent ? `${parent} / ${category.name}` : category.name;
		const own = { name, value: String(category.id) };
		return [own, ...categoryOptions(category.categories ?? [], name)];
	});
}

export const listSearch = {
	async searchProducts(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return await searchPage(
			this,
			'/products',
			'products',
			{ term: filter },
			paginationToken,
			(record) => {
				const brand = record.brandName ? ` (${record.brandName})` : '';
				return { name: `${record.name}${brand}`, value: String(record.id) };
			},
		);
	},

	async searchComponents(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return await searchPage(
			this,
			'/components',
			'components',
			{ term: filter },
			paginationToken,
			(record) => {
				return { name: String(record.name), value: String(record.id) };
			},
		);
	},

	async searchPassports(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return await searchPage(this, '/dpps', 'dpps', { term: filter }, paginationToken, (record) => {
			const product = record.unlockable as IDataObject | undefined;
			const label = record.description ?? product?.name ?? '';
			return { name: `${record.code} ${label}`.trim(), value: String(record.code) };
		});
	},

	// The lot list finds a lot by its exact identifier only, so the
	// search narrows the newest lots by what the identifier contains.
	async searchLots(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		const result = await searchPage(this, '/lots', 'lots', {}, paginationToken, (record) => {
			return { name: String(record.identifier), value: String(record.id) };
		});
		const needle = (filter ?? '').toLowerCase();
		const results = result.results.filter((item) => item.name.toLowerCase().includes(needle));
		return { ...result, results };
	},

	async searchTasks(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		const query = { list: 'all', term: filter };
		return await searchPage(this, '/tasks', 'tasks', query, paginationToken, (record) => {
			return { name: String(record.title), value: String(record.id) };
		});
	},

	async searchAssignees(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const qs = { term: filter };
		const answer = (await apiRequest.call(this, 'GET', '/tasks/assignees', { qs })) as IDataObject;
		const assignees = (answer.assignees ?? []) as IDataObject[];
		const results = assignees.map((assignee) => {
			return { name: String(assignee.name), value: String(assignee.key) };
		});
		return { results };
	},
};

export const loadOptions = {
	async getProductPropertyTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const answer = (await apiRequest.call(this, 'GET', '/products/new')) as IDataObject;
		const types = (answer.properties ?? {}) as { [name: string]: IDataObject };
		const options = Object.entries(types).map(([name, type]) => {
			const label = type.mandatory ? `${name} (mandatory)` : name;
			return { name: label, value: String(type.id) };
		});
		return options.sort(byName);
	},

	async getProductCategories(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const answer = (await apiRequest.call(this, 'GET', '/product_categories')) as IDataObject;
		const categories = (answer.productCategories ?? []) as Category[];
		return categoryOptions(categories).sort(byName);
	},

	async getBrands(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const qs = { per_page: 500 };
		const answer = (await apiRequest.call(this, 'GET', '/brands', { qs })) as IDataObject;
		const brands = (answer.brands ?? []) as Record[];
		const options = brands.map((brand) => ({ name: String(brand.name), value: brand.id }));
		return options.sort(byName);
	},
};
