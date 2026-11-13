// Keeps test/fixtures/ byte-equal to the recorded API answers and the OpenAPI contract of Kadmo's app.
// usage: node scripts/fixtures.mjs sync|check --from=<a kadmo-platform checkout>
import { copyFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [mode, ...rest] = process.argv.slice(2);
const from = rest.find((arg) => arg.startsWith('--from='))?.slice('--from='.length);
if (!['sync', 'check'].includes(mode) || !from) {
	console.error('usage: node scripts/fixtures.mjs sync|check --from=<a kadmo-platform checkout>');
	process.exit(64);
}

const apiDir = resolve(from, 'website/src/lib/api-v1');
const pairs = [
	...readdirSync(join(apiDir, 'fixtures'))
		.filter((name) => name.endsWith('.json'))
		.map((name) => [join(apiDir, 'fixtures', name), join('test/fixtures/api', name)]),
	[join(apiDir, 'contract/openapi.v1.json'), 'test/fixtures/openapi.v1.json'],
];

let drift = 0;
for (const [source, target] of pairs) {
	if (mode === 'sync') {
		mkdirSync(join(target, '..'), { recursive: true });
		copyFileSync(source, target);
		continue;
	}
	if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) {
		console.error(`differs: ${target}`);
		drift++;
	}
}
const known = new Set(pairs.map(([, target]) => target));
if (mode === 'check') {
	for (const name of readdirSync('test/fixtures/api')) {
		if (!known.has(join('test/fixtures/api', name))) {
			console.error(`not in the app any more: test/fixtures/api/${name}`);
			drift++;
		}
	}
}
console.log(`${mode}: ${pairs.length} files${mode === 'check' ? `, ${drift} differ` : ''}`);
process.exitCode = drift ? 1 : 0;
