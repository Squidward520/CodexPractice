'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');
const root = path.resolve(__dirname, '..');
for (const directory of ['js', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(path.join(root, directory))) {
    if (/\.(js|cjs)$/.test(file)) new Script(fs.readFileSync(path.join(root, directory, file), 'utf8'), { filename: file });
  }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const asset = match[1];
  if (/^(https?:|\/\/)/.test(asset)) throw new Error(`External asset not allowed: ${asset}`);
  if (!fs.existsSync(path.join(root, asset))) throw new Error(`Missing asset: ${asset}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML ids');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
  if (!ids.includes(match[1])) throw new Error(`Missing UI element: ${match[1]}`);
}
console.log('PASS: JavaScript syntax, local assets, unique HTML IDs and application DOM references.');
