import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const url = process.env.WM_SUPABASE_URL || '';
const key = process.env.WM_SUPABASE_PUBLISHABLE_KEY || '';
const origin = process.env.WM_STAFF_ORIGIN || '';
const publicOrigin = 'https://issaracbwm-a11y.github.io';

if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new Error('Set WM_SUPABASE_URL to the project HTTPS URL');
if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Set WM_SUPABASE_PUBLISHABLE_KEY to a publishable key');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) || new URL(origin).origin !== origin || origin === publicOrigin) {
  throw new Error('Set WM_STAFF_ORIGIN to the separate staff site HTTPS origin');
}

const output = new URL('./dist-staff/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'app.css', 'js', 'vendor']) {
  await cp(new URL(path, import.meta.url), new URL(path, output), { recursive: true });
}

const indexPath = new URL('index.html', output);
const html = await readFile(indexPath, 'utf8');
const configScript = 'src="js/sync-config.js"';
if (!html.includes(configScript)) throw new Error('Staff configuration script was not found');
await writeFile(indexPath, html.replace(configScript, 'src="js/sync-config.js?v=staff-build-1"'));
await writeFile(new URL('js/sync-config.js', output), "'use strict';\nTS.cloudConfig = " + JSON.stringify({ url, key, origin }) + ';\n');
console.log('Staff site output: dist-staff');
