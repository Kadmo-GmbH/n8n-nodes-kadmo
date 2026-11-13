// Runs the two static legs of @n8n/scan-community-package on local folders: its CLI takes published names only.
// usage: node scripts/scan-local.mjs <path to the scanner's dist/scanner.js> <source dir> <unpacked tarball dir>
import { pathToFileURL } from 'node:url';

const [scannerPath, sourceDir, tarballDir] = process.argv.slice(2);
if (!scannerPath || !sourceDir || !tarballDir) {
	console.error('usage: node scripts/scan-local.mjs <scanner dist/scanner.js> <source dir> <unpacked tarball dir>');
	process.exit(64);
}
const scanner = await import(pathToFileURL(scannerPath).href);
const legs = [
	['source', sourceDir, scanner.SOURCE_FILE_PATTERNS],
	['tarball', tarballDir, ['**/*.js', 'package.json']],
];
let failed = false;
for (const [label, dir, patterns] of legs) {
	const result = await scanner.analyzePackage(dir, patterns);
	console.log(`${label}: passed=${result.passed}`);
	if (result.details) console.log(result.details);
	if (!result.passed) failed = true;
}
process.exitCode = failed ? 2 : 0;
