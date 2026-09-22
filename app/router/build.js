'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'migration-studio', 'webapp');
const DEST = path.join(__dirname, 'resources');
const ALIAS = path.join(DEST, 'AppRouterDatavapte.datavaptemigrationstudio-1.0.0');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function build() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) {
    throw new Error('UI5 webapp not found at ' + SRC);
  }
  fs.rmSync(DEST, { recursive: true, force: true });
  copyDir(SRC, DEST);
  copyDir(SRC, ALIAS);
  console.log('Copied UI5 webapp into approuter resources/');
}

build();
