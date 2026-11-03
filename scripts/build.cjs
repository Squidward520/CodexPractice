'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('./check.cjs');
const root = path.resolve(__dirname, '..');
const files = ['index.html', 'styles.css', 'js/simulation.js', 'js/renderer.js', 'js/app.js'];
for (const file of files) {
  const target = path.join(root, 'dist', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`PASS: ${files.length} static assets copied to dist/. No bundler or runtime dependencies.`);
