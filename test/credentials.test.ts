import { describe, expect, it } from 'vitest';

import { KadmoApi } from '../credentials/KadmoApi.credentials';
import { Kadmo } from '../nodes/Kadmo/Kadmo.node';
import { apiBaseUrl } from '../nodes/Kadmo/transport/request';

const credential = new KadmoApi();

describe('KadmoApi credential', () => {
	it('is named kadmoApi and is the one the node asks for', () => {
		expect(credential.name).toBe('kadmoApi');
		expect(credential.displayName).toBe('Kadmo API');
		expect(new Kadmo().description.credentials).toEqual([{ name: 'kadmoApi', required: true }]);
	});

	it('the API token is a required password field', () => {
		const token = credential.properties.find((property) => property.name === 'apiToken');
		expect(token).toMatchObject({ type: 'string', required: true, default: '', typeOptions: { password: true } });
	});

	it('the Base URL defaults to the Kadmo app', () => {
		const baseUrl = credential.properties.find((property) => property.name === 'baseUrl');
		expect(baseUrl).toMatchObject({ type: 'string', required: true, default: 'https://app.kadmo.ai' });
		expect(baseUrl?.typeOptions?.password).toBeUndefined();
	});

	it('authenticates with a Bearer header', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
		});
	});

	it('tests the token with GET /me', () => {
		expect(credential.test.request).toMatchObject({ url: '/me', method: 'GET' });
		expect(String(credential.test.request.baseURL)).toMatch(/^=\{\{\$credentials\.baseUrl.*\}\}\/api\/v1$/);
	});

	it('the test request’s base URL trims the address the way the node does', () => {
		const expression = String(credential.test.request.baseURL);
		const sources = [...expression.matchAll(/\.replace\(\/(.+?)\/, ""\)/g)].map((match) => match[1]);
		expect(sources).toHaveLength(2);
		expect(expression).toContain('.trim()');
		const evaluate = (address: string) =>
			`${sources.reduce((value, source) => value.replace(new RegExp(source), ''), address.trim())}/api/v1`;
		for (const address of [
			'https://app.kadmo.ai',
			'https://app.kadmo.ai/',
			'https://app.kadmo.ai/api/v1',
			'https://app.kadmo.ai/api/v1/',
			' https://kadmo.example.test// ',
		]) {
			expect(evaluate(address)).toBe(apiBaseUrl(address));
		}
	});
});
