'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const test = cds.test(path.join(__dirname, '..'));
const FIXTURE_XML = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xml');

describe('MigrationService upload', () => {
  it('uploads a cockpit XML template and expands every tab', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    });
    const data = await response.json();
    assert.equal(response.status, 200, data.error?.message || JSON.stringify(data));
    assert.ok(data.ID);
    assert.equal(data.sheetCount, 4);
    assert.equal(data.status, 'Parsed');

    const read = await fetch(
      `${url}/odata/v4/migration/Templates(${data.ID})?$expand=sheets($expand=fields,rows)`
    );
    const template = await read.json();
    assert.equal(read.status, 200);
    assert.equal(template.sheets.length, 4);
    const master = template.sheets.find((s) => s.name === 'Bank Master');
    assert.ok(master);
    assert.ok(master.fields.length >= 8);
    assert.ok(master.rows.length >= 3);
  });

  it('rejects unsupported file types', async () => {
    const { url } = await test;
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'notes.txt',
        mediaType: 'text/plain',
        content: Buffer.from('hello').toString('base64')
      })
    });
    assert.ok(response.status >= 400);
  });
});
