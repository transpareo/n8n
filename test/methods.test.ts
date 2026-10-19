import { describe, expect, it } from 'vitest';
import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { listSearch, loadOptions } from '../nodes/Transpareo/methods';
import { fakeContext } from './context';

function asLoadOptions(context: object) {
	return context as unknown as ILoadOptionsFunctions;
}

describe('Transpareo list searches', () => {
	it('searches products by term, a page at a time', async () => {
		const products = Array.from({ length: 50 }, (_, index) => ({
			id: index + 1,
			name: `Cream ${index + 1}`,
			brandName: 'NaturaCare',
		}));
		const { context, httpRequestWithAuthentication } = fakeContext({ reply: () => ({ products }) });

		const result = await listSearch.searchProducts.call(asLoadOptions(context), 'cream', '2');

		const [type, request] = httpRequestWithAuthentication.mock.calls[0];
		expect(type).toBe('transpareoApi');
		expect(request.url).toBe('https://acme.example.com/api/products');
		expect(request.qs).toEqual({ term: 'cream', per_page: 50, page: 2 });
		expect(result.results[0]).toEqual({ name: 'Cream 1 (NaturaCare)', value: '1' });
		expect(result.paginationToken).toBe('3');
	});

	// The list searches and option lists call the API themselves, so
	// a refusal reads the same there as on an operation.
	it("heads a refused search with the workspace's message", async () => {
		const answer = {
			error: 'DPP_FORBIDDEN',
			message: 'Reading these records needs the dpp_read permission.',
			hint: 'This credential holds: product_access.',
		};
		const refusal = Object.assign(new Error('Forbidden'), {
			httpCode: '403',
			context: { data: answer },
		});
		const { context } = fakeContext({
			reply: () => {
				throw refusal;
			},
		});

		const search = listSearch.searchPassports.call(asLoadOptions(context), 'A1');

		await expect(search).rejects.toMatchObject({
			message: 'Reading these records needs the dpp_read permission. (DPP_FORBIDDEN)',
			description: 'This credential holds: product_access.',
		});
	});

	it('stops paging when a page comes back short', async () => {
		const { context } = fakeContext({ reply: () => ({ components: [{ id: 4, name: 'Aqua' }] }) });

		const result = await listSearch.searchComponents.call(asLoadOptions(context));

		expect(result).toEqual({ results: [{ name: 'Aqua', value: '4' }], paginationToken: undefined });
	});

	it('offers passports by code, named by their description', async () => {
		const dpps = [
			{ id: 14, code: 'A1B2C3D4E', description: 'Face Cream 50ml' },
			{ id: 15, code: 'F6G7H8J9K', unlockable: { name: 'Face Cream' } },
		];
		const { context, httpRequestWithAuthentication } = fakeContext({ reply: () => ({ dpps }) });

		const result = await listSearch.searchPassports.call(asLoadOptions(context), 'A1');

		expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'https://acme.example.com/api/dpps',
		);
		expect(result.results).toEqual([
			{ name: 'A1B2C3D4E Face Cream 50ml', value: 'A1B2C3D4E' },
			{ name: 'F6G7H8J9K Face Cream', value: 'F6G7H8J9K' },
		]);
	});

	it('narrows lots to the identifiers containing the search', async () => {
		const lots = [
			{ id: 7, identifier: 'L2026-09', productId: 11 },
			{ id: 8, identifier: 'L2026-10', productId: 11 },
		];
		const { context } = fakeContext({ reply: () => ({ lots }) });

		const result = await listSearch.searchLots.call(asLoadOptions(context), '09');

		expect(result.results).toEqual([{ name: 'L2026-09', value: '7' }]);
	});

	it('searches every task the credential takes part in', async () => {
		const tasks = [{ id: 42, title: 'Check the supplier declaration' }];
		const { context, httpRequestWithAuthentication } = fakeContext({ reply: () => ({ tasks }) });

		const result = await listSearch.searchTasks.call(asLoadOptions(context), 'supplier');

		expect(httpRequestWithAuthentication.mock.calls[0][1].qs).toMatchObject({
			list: 'all',
			term: 'supplier',
		});
		expect(result.results).toEqual([{ name: 'Check the supplier declaration', value: '42' }]);
	});

	it('finds assignees by name with the key a task takes', async () => {
		const assignees = [
			{ key: 'AccessGroup:3', name: 'Group Quality' },
			{ key: 'User:15', name: 'Hans Tester' },
		];
		const { context, httpRequestWithAuthentication } = fakeContext({
			reply: () => ({ assignees }),
		});

		const result = await listSearch.searchAssignees.call(asLoadOptions(context), 'qual');

		expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'https://acme.example.com/api/tasks/assignees',
		);
		expect(result.results).toEqual([
			{ name: 'Group Quality', value: 'AccessGroup:3' },
			{ name: 'Hans Tester', value: 'User:15' },
		]);
	});
});

describe('Transpareo option lists', () => {
	it('lists the product property types sorted by name', async () => {
		const properties = {
			Chemistry: { id: 21, mandatory: true },
			Capacity: { id: 22 },
		};
		const { context, httpRequestWithAuthentication } = fakeContext({
			reply: () => ({ properties }),
		});

		const options = await loadOptions.getProductPropertyTypes.call(asLoadOptions(context));

		expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'https://acme.example.com/api/products/new',
		);
		expect(options).toEqual([
			{ name: 'Capacity', value: '22' },
			{ name: 'Chemistry (mandatory)', value: '21' },
		]);
	});

	it('lists nested product categories with their path', async () => {
		const productCategories = [
			{ id: 1, name: 'Skincare', categories: [{ id: 2, name: 'Creams' }] },
			{ id: 3, name: 'Batteries' },
		];
		const { context } = fakeContext({ reply: () => ({ productCategories }) });

		const options = await loadOptions.getProductCategories.call(asLoadOptions(context));

		expect(options).toEqual([
			{ name: 'Batteries', value: '3' },
			{ name: 'Skincare', value: '1' },
			{ name: 'Skincare / Creams', value: '2' },
		]);
	});

	it('lists the brands sorted by name', async () => {
		const brands = [
			{ id: 2, name: 'Volturra' },
			{ id: 1, name: 'NaturaCare' },
		];
		const { context } = fakeContext({ reply: () => ({ brands }) });

		const options = await loadOptions.getBrands.call(asLoadOptions(context));

		expect(options).toEqual([
			{ name: 'NaturaCare', value: 1 },
			{ name: 'Volturra', value: 2 },
		]);
	});
});
