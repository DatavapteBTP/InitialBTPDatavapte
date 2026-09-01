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

  it('saves edited sheet rows', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const uploaded = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    }).then((res) => res.json());

    const read = await fetch(
      `${url}/odata/v4/migration/Templates(${uploaded.ID})?$expand=sheets($expand=rows)`
    ).then((res) => res.json());
    const master = read.sheets.find((s) => s.name === 'Bank Master');
    assert.ok(master);

    const save = await fetch(url + '/odata/v4/migration/saveSheetData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: master.ID,
        introText: '',
        rows: JSON.stringify([
          { rowIndex: 1, values: ['FR', '30004', 'Edited Bank', '', '', 'Paris', '', ''] }
        ])
      })
    });
    const saved = await save.json();
    assert.equal(save.status, 200, saved.error?.message || JSON.stringify(saved));
    assert.equal(saved.value, 1);

    const after = await fetch(
      `${url}/odata/v4/migration/Sheets(${master.ID})?$expand=rows`
    ).then((res) => res.json());
    assert.equal(after.rows.length, 1);
    assert.match(after.rows[0].values, /Edited Bank/);
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
