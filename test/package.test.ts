import { describe, expect, it } from 'vitest';
import manifest from '../package.json';
import { TranspareoOAuth2Api } from '../credentials/TranspareoOAuth2Api.credentials';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { TranspareoPollingTrigger } from '../nodes/TranspareoPollingTrigger/TranspareoPollingTrigger.node';
import { TranspareoTrigger } from '../nodes/TranspareoTrigger/TranspareoTrigger.node';
import { CREDENTIAL_TYPE } from '../nodes/shared/transport';

type Codex = { node: string };

const sources = import.meta.glob(
	['../credentials/**/*.ts', '../nodes/**/*.{ts,json}', './**/*.ts'],
	{
		query: '?raw',
		import: 'default',
		eager: true,
	},
) as Record<string, string>;

const documents = import.meta.glob(
	['../README.md', '../CHANGELOG.md', '../TRADEMARKS.md', '../package.json', '../examples/*.json'],
	{
		query: '?raw',
		import: 'default',
		eager: true,
	},
) as Record<string, string>;

const codices = import.meta.glob('../nodes/*/*.node.json', {
	import: 'default',
	eager: true,
}) as Record<string, Codex>;

function sourceOf(distPath: string): string {
	return distPath.replace(/^dist\//, '../').replace(/\.js$/, '.ts');
}

describe('the package as n8n loads it', () => {
	it('names every node and credential by a file whose class carries the same name', () => {
		const entries = [...manifest.n8n.nodes, ...manifest.n8n.credentials];
		const classes = [Transpareo, TranspareoTrigger, TranspareoPollingTrigger, TranspareoOAuth2Api];

		const names = entries.map((entry) => entry.split('/').pop()?.split('.')[0]);
		expect(names).toEqual(classes.map((type) => type.name));
		for (const entry of entries) expect(Object.keys(sources)).toContain(sourceOf(entry));
	});

	it('asks for the credential by the name it declares, in every node and example', () => {
		const { name } = new TranspareoOAuth2Api();
		for (const type of [Transpareo, TranspareoTrigger, TranspareoPollingTrigger]) {
			const credentials = new type().description.credentials ?? [];
			expect(credentials.map((credential) => credential.name)).toEqual([name]);
		}
		expect(CREDENTIAL_TYPE).toBe(name);

		const examples = ['../examples/passport-published.json', '../examples/bulk-upload.json'];
		for (const example of examples) {
			const nodes = JSON.parse(documents[example]).nodes as Array<{ credentials?: object }>;
			const asked = nodes.flatMap((node) => Object.keys(node.credentials ?? {}));
			expect(new Set(asked)).toEqual(new Set([name]));
		}
	});

	it('gives every node a codex file naming it within the package', () => {
		for (const entry of manifest.n8n.nodes) {
			const codex = codices[sourceOf(entry).replace(/\.ts$/, '.json')];
			const type = entry.split('/').slice(-2)[0];
			const name = type.charAt(0).toLowerCase() + type.slice(1);
			expect(codex.node).toBe(`${manifest.name}.${name}`);
		}
	});

	it('keeps the request mock out of what the live suite loads', () => {
		const loaded = ['./harness.ts', './e2e/live.test.ts'];
		for (const file of loaded) {
			expect(Object.keys(sources)).toContain(file);
			expect(sources[file]).not.toMatch(/from '(nock|\.\/fake-workspace)'/);
		}
	});

	it('is published publicly under the transpareo organisation, named as n8n requires', () => {
		expect(manifest.name).toBe('@transpareo/n8n-nodes-transpareo');
		expect(manifest.name).toMatch(/^@[^/]+\/n8n-nodes-.+$/);
		expect(manifest.keywords).toContain('n8n-community-node-package');
		expect((manifest as { publishConfig?: object }).publishConfig).toEqual({ access: 'public' });
	});

	it('names the package in the example workflow and the install line', () => {
		const example = JSON.parse(documents['../examples/passport-published.json']);
		const types = (example.nodes as Array<{ type: string }>).map((node) => node.type);
		const ours = types.filter((type) => !type.startsWith('n8n-nodes-base.'));

		expect(ours).toEqual([`${manifest.name}.transpareoTrigger`, `${manifest.name}.transpareo`]);
		expect(documents['../README.md']).toContain(`enter \`${manifest.name}\``);
	});

	// Two imports scale to a catalogue of any size the importer takes,
	// since a passport row finds its product by GTIN: no product list
	// is paged through to learn IDs.
	it('imports the products and then their passports in the bulk upload example', () => {
		const example = JSON.parse(documents['../examples/bulk-upload.json']);
		const nodes = example.nodes as Array<{ type: string; parameters: Record<string, string> }>;
		const ours = nodes.filter((one) => one.type === `${manifest.name}.transpareo`);
		const steps = ours.map((one) => {
			const { resource, operation, dataType } = one.parameters;
			return `${resource}.${operation}.${dataType}`;
		});

		expect(nodes[1].type).toBe('n8n-nodes-base.readWriteFile');
		expect(steps).toEqual(['import.run.products', 'import.run.dpps']);
	});

	it('has no runtime dependencies', () => {
		expect((manifest as { dependencies?: object }).dependencies ?? {}).toEqual({});
		expect(Object.keys(manifest.peerDependencies)).toEqual(['n8n-workflow']);
	});

	it('writes no dashes or arrows that read as typography', () => {
		const glyphs = [0x2013, 0x2014, 0x2190, 0x2191, 0x2192, 0x2193];
		const banned = new RegExp(`[${String.fromCharCode(...glyphs)}]`);
		const files = { ...sources, ...documents };
		const offenders = Object.keys(files).filter((file) => banned.test(files[file]));

		expect(Object.keys(documents)).toHaveLength(6);
		expect(offenders).toEqual([]);
	});

	it('names n8n@transpareo.com as its only address, for the author and every contact', () => {
		const contact = 'n8n@transpareo.com';
		const address = /[\w.%+-]+@[\w-]+(\.[\w-]+)+/g;
		const named = Object.values(documents).flatMap((text) => text.match(address) ?? []);

		expect(manifest.author.email).toBe(contact);
		expect(documents['../README.md']).toContain(`<${contact}>`);
		expect(documents['../TRADEMARKS.md']).toContain(contact);
		expect(new Set(named)).toEqual(new Set([contact]));
	});
});
