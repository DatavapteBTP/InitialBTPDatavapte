'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP_DIR = __dirname;
const SRC = path.join(APP_DIR, 'webapp');
const DEST = path.join(APP_DIR, 'dist');
const XS_APP = path.join(APP_DIR, 'xs-app.json');
const ZIP_NAME = 'datavaptemigrationstudio.zip';
const ZIP_PATH = path.join(DEST, ZIP_NAME);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function collectFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, full, files);
      continue;
    }
    if (entry.name.endsWith('.zip')) continue;
    files.push({
      name: path.relative(root, full).replace(/\\/g, '/'),
      data: fs.readFileSync(full)
    });
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  return {
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  };
}

function writeZip(entries, outPath) {
  const { date, time } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, name, payload]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + payload.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outPath, Buffer.concat([...locals, centralDir, end]));
}

function build() {
  fs.rmSync(DEST, { recursive: true, force: true });
  copyDir(SRC, DEST);
  if (!fs.existsSync(XS_APP)) {
    throw new Error('xs-app.json is required next to webapp/ for HTML5 App Repo.');
  }
  fs.copyFileSync(XS_APP, path.join(DEST, 'xs-app.json'));

  const manifest = path.join(DEST, 'manifest.json');
  if (!fs.existsSync(manifest)) {
    throw new Error('dist/manifest.json is missing; HTML5 App Repo will reject the upload.');
  }

  const files = collectFiles(DEST);
  const names = new Set(files.map((file) => file.name));
  if (!names.has('manifest.json') || !names.has('xs-app.json')) {
    throw new Error('HTML5 zip must contain manifest.json and xs-app.json at the archive root.');
  }

  writeZip(files, ZIP_PATH);
  console.log(`Built ${path.relative(APP_DIR, DEST)} with ${files.length} files`);
  console.log(`Wrote ${path.relative(APP_DIR, ZIP_PATH)} (manifest.json + xs-app.json at zip root)`);
}

build();
