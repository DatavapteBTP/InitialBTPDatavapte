'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const zlib = require('zlib');

const APP_DIR = path.join(__dirname, '..', 'app', 'migration-studio');
const ZIP_PATH = path.join(APP_DIR, 'dist', 'datavaptemigrationstudio.zip');

function listZipRootEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const names = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compressed = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    names.push(name);
    offset += 30 + nameLen + extraLen + compressed;
    if (method !== 0 && method !== 8) {
      throw new Error('Unsupported zip method ' + method + ' for ' + name);
    }
    zlib.inflateRawSync; // keep zlib imported for sanity
  }
  return names;
}

describe('HTML5 App Repo package', () => {
  it('puts manifest.json and xs-app.json at the zip root', () => {
    execFileSync(process.execPath, [path.join(APP_DIR, 'build.js')], { cwd: APP_DIR, stdio: 'pipe' });
    assert.equal(fs.existsSync(ZIP_PATH), true);
    const names = listZipRootEntries(ZIP_PATH);
    assert.ok(names.includes('manifest.json'), 'manifest.json must be at zip root: ' + names.slice(0, 8).join(', '));
    assert.ok(names.includes('xs-app.json'), 'xs-app.json must be at zip root: ' + names.slice(0, 8).join(', '));
    assert.ok(names.includes('index.html'));
    assert.equal(names.some((name) => name.startsWith('dist/')), false);
  });

  it('does not reference destinations in the HTML5 xs-app catch-all', () => {
    const xsApp = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'xs-app.json'), 'utf8'));
    assert.equal(xsApp.welcomeFile, '/index.html');
    assert.equal(xsApp.authenticationMethod, 'route');
    assert.equal(xsApp.routes.length, 1);
    assert.equal(xsApp.routes[0].service, 'html5-apps-repo-rt');
    assert.equal(xsApp.routes[0].authenticationType, 'none');
    assert.equal(xsApp.routes.some((route) => route.destination), false);
  });
});
