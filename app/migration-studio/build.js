'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'webapp');
const dest = path.join(__dirname, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
console.log('Copied UI5 webapp to dist/');
