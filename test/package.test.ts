import { describe, expect, it } from 'vitest';

import pkg from '../package.json';

describe('package.json', () => {
	it('is the @kadmo community node package under MIT', () => {
		expect(pkg.name).toBe('@kadmo/n8n-nodes-kadmo');
		expect(pkg.license).toBe('MIT');
		expect(pkg.keywords).toContain('n8n-community-node-package');
	});

	it('has no runtime dependencies and takes n8n-workflow from the instance', () => {
		expect(pkg).not.toHaveProperty('dependencies');
		expect(pkg.peerDependencies).toEqual({ 'n8n-workflow': '*' });
	});

	it('publishes only dist, publicly', () => {
		expect(pkg.files).toEqual(['dist']);
		expect(pkg.publishConfig.access).toBe('public');
	});

	it('declares the strict n8n block with the credential and the node', () => {
		expect(pkg.n8n.strict).toBe(true);
		expect(pkg.n8n.n8nNodesApiVersion).toBe(1);
		expect(pkg.n8n.credentials).toContain('dist/credentials/KadmoApi.credentials.js');
		expect(pkg.n8n.nodes).toContain('dist/nodes/Kadmo/Kadmo.node.js');
		expect(pkg.n8n.nodes).toContain('dist/nodes/Kadmo/KadmoTrigger.node.js');
		for (const entry of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) {
			expect(entry).toMatch(/^dist\/.+\.js$/);
		}
	});
});
