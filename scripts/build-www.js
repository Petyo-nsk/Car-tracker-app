// Събира файловете на приложението в папка www/ — оттам Capacitor ги слага в Android/iOS приложението.
// Копират се САМО изброените файлове: business/, backend/ и личните бележки никога не влизат в приложението.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const FILES = ['index.html', 'privacy.html', 'terms.html', 'manifest.json', 'sw.js'];
const DIRS = ['icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
console.log('www/ готова:', [...FILES, ...DIRS.map((d) => d + '/')].join(', '));
