'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseMigrationExcel, parseTypeLength, detectSheetType, resolveValueHelpKey } = require('../srv/lib/excel-parser');
const { parseSpreadsheetML } = require('../srv/lib/spreadsheetml');

const FIXTURE_XLSX = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xlsx');
const FIXTURE_XML = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xml');

describe('sheet type detection', () => {
  it('classifies introduction, field list, and data tabs', () => {
    assert.equal(detectSheetType('Introduction'), 'Introduction');
    assert.equal(detectSheetType('Field List'), 'FieldList');
    assert.equal(detectSheetType('PV MM - Product'), 'ValueHelp');
    assert.equal(detectSheetType('Bank Master'), 'Data');
  });
});

describe('type / length parsing', () => {
  it('reads CHAR, NUMC and decimal definitions', () => {
    assert.deepEqual(parseTypeLength('CHAR 3'), { dataType: 'CHAR', length: '3', decimals: '' });
    assert.deepEqual(parseTypeLength('DEC 9,5'), { dataType: 'DEC', length: '9', decimals: '5' });
    assert.deepEqual(parseTypeLength('ETE;80;0;C;80;0'), { dataType: 'ETE', length: '80', decimals: '' });
    assert.equal(parseTypeLength('LANG 1').dataType, 'LANG');
  });
});

describe('SpreadsheetML 2003 parser', () => {
  it('reads every worksheet from a Migration Cockpit XML file', () => {
    const workbook = parseSpreadsheetML(fs.readFileSync(FIXTURE_XML));
    assert.deepEqual(workbook.sheetNames, ['Introduction', 'Field List', 'Bank Master', 'Bank Address']);
    assert.equal(workbook.sheets['Bank Master'][7][0], 'Bank Country Key *');
    assert.equal(workbook.sheets['Bank Master'][8][0], 'DE');
  });
});

describe('migration template parser', () => {
  it('parses the XML cockpit template into UI-ready sheets', () => {
    const parsed = parseMigrationExcel(fs.readFileSync(FIXTURE_XML), 'Source_data_for_Bank.xml');
    assert.equal(parsed.sheetCount, 4);
    assert.equal(parsed.objectName, 'Bank');
    assert.equal(parsed.sheets[0].sheetType, 'Introduction');
    assert.match(parsed.sheets[0].introText, /Field List/);

    const fieldList = parsed.sheets[1];
    assert.equal(fieldList.sheetType, 'FieldList');
    assert.ok(fieldList.rows.length >= 8);

    const master = parsed.sheets[2];
    assert.equal(master.sheetType, 'Data');
    assert.equal(master.structureName, 'S_BNKA');
    assert.equal(master.fields.length, 8);
    assert.equal(master.fields[0].technicalName, 'BANKS');
    assert.equal(master.fields[0].description, 'Bank Country Key');
    assert.equal(master.fields[0].mandatory, true);
    assert.equal(master.fields[0].isKey, true);
    assert.equal(master.fields[0].dataType, 'CHAR');
    assert.equal(master.fields[0].length, '3');
    assert.equal(master.dataRowCount, 3);
    const firstRow = JSON.parse(master.rows[0].values);
    assert.equal(firstRow[2], 'City Bank');

    const address = parsed.sheets[3];
    assert.equal(address.fields.length, 4);
    assert.equal(address.dataRowCount, 2);
  });

  it('parses the xlsx cockpit template the same way', () => {
    const parsed = parseMigrationExcel(fs.readFileSync(FIXTURE_XLSX), 'Source_data_for_Bank.xlsx');
    assert.equal(parsed.sheetCount, 4);
    const master = parsed.sheets.find((s) => s.name === 'Bank Master');
    assert.equal(master.fields[1].technicalName, 'BANKL');
    assert.equal(master.fields[2].mandatory, true);
    assert.equal(JSON.parse(master.rows[1].values)[5], 'San Francisco');
  });

  it('falls back to first-row headers for generic workbooks', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Customer *', 'City', 'Country'],
        ['1000', 'Walldorf', 'DE'],
        ['2000', 'Bangalore', 'IN']
      ]),
      'Customers'
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const parsed = parseMigrationExcel(buffer, 'customers.xlsx');
    assert.equal(parsed.sheets[0].sheetType, 'Data');
    assert.equal(parsed.sheets[0].fields[0].mandatory, true);
    assert.equal(parsed.sheets[0].fields[0].description, 'Customer');
    assert.equal(parsed.sheets[0].dataRowCount, 2);
  });

  it('fits Migration Cockpit help text into the description column', () => {
    const { fitField } = require('../srv/lib/excel-parser');
    const fitted = fitField({
      columnIndex: 0,
      technicalName: 'MSTAE',
      description: 'Valuation Type&#10;&#10;' + 'x'.repeat(2500),
      dataType: 'CHAR',
      length: '10',
      decimals: '',
      groupName: 'Basic Data',
      sapFieldName: 'MSTAE'
    });
    assert.ok(fitted.description.startsWith('Valuation Type\n\n'));
    assert.equal(fitted.description.length, 2000);
  });

  it('ignores phantom million-row Excel used ranges', () => {
    const XLSX = require('xlsx');
    const { compactSheetRef } = require('../srv/lib/excel-parser');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Source Data for Migration Object: Bank'],
      [''],
      [''],
      ['S_BNKA', '', ''],
      ['BANKS', 'BANKL', 'BANKA'],
      ['CHAR 3', 'CHAR 15', 'CHAR 60'],
      ['Bank Data', 'Bank Data', 'Bank Data'],
      ['Bank Country Key *', 'Bank Key *', 'Bank Name *'],
      ['DE', '20060001', 'City Bank']
    ]);
    sheet['!ref'] = 'A1:ALW100011';
    compactSheetRef(sheet);
    assert.match(sheet['!ref'], /^A1:/);
    const end = XLSX.utils.decode_range(sheet['!ref']).e;
    assert.ok(end.r < 50, sheet['!ref']);
    assert.ok(end.c < 20, sheet['!ref']);
    XLSX.utils.book_append_sheet(wb, sheet, 'Bank Master');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const parsed = parseMigrationExcel(buffer, 'banks.xlsx');
    const master = parsed.sheets[0];
    assert.equal(master.fields[0].technicalName, 'BANKS');
    assert.equal(master.dataRowCount, 1);
  });

  it('parses a Product Migration Cockpit xlsx workbook', () => {
    const product = path.join(__dirname, 'fixtures', 'MM_Product.xlsx');
    const parsed = parseMigrationExcel(fs.readFileSync(product), 'MM - Product 08032026191310.xlsx');
    assert.ok(parsed.sheetCount >= 29);
    const basic = parsed.sheets.find((sheet) => sheet.name === 'Basic Data');
    assert.ok(basic);
    assert.equal(basic.sheetType, 'Data');
    assert.ok(basic.fields.length >= 8);
    const productField = basic.fields.find((field) => field.technicalName === 'PRODUCT');
    assert.ok(productField);
    assert.match(productField.description, /Product Number/i);
    assert.equal(productField.valueHelpKey || '', '');
    const fieldList = parsed.sheets.find((sheet) => sheet.sheetType === 'FieldList');
    assert.ok(fieldList.dataRowCount >= 20);
    const pv = parsed.sheets.find((sheet) => sheet.sheetType === 'ValueHelp');
    assert.ok(pv);
    const mtart = basic.fields.find((field) => field.technicalName === 'MTART');
    assert.equal(mtart.valueHelpKey, 'T134-MTART');
    const attyp = basic.fields.find((field) => field.technicalName === 'ATTYP');
    assert.equal(attyp.valueHelpKey || '', '');
    const types = parsed.valueHelps['T134-MTART'];
    assert.ok(Array.isArray(types) && types.length > 0);
    assert.ok(types.some((item) => item.key === 'HAWA'));
  });

  it('turns PV tab lists into dropdowns for row-3 table-field names', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Source Data for Migration Object: Product'],
        ['Version'],
        ['', 'T134-MTART', ''],
        ['S_MARA', 'S_MARA', 'S_MARA'],
        ['PRODUCT', 'MTART', 'ATTYP'],
        ['CHAR 80', 'CHAR 4', 'CHAR 2'],
        ['Key', 'Header Data', 'Header Data'],
        ['Product Number *', 'Product Type *', 'Product Category'],
        ['1000', 'HAWA', '']
      ]),
      'Basic Data'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['T134', 'T023'],
        ['MTART', 'MATKL'],
        ['HAWA=>Trading Goods', '01=>Group 1'],
        ['FERT=>Finished Product', '02=>Group 2']
      ]),
      'PV MM - Product'
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const parsed = parseMigrationExcel(buffer, 'product.xlsx');
    const basic = parsed.sheets.find((sheet) => sheet.name === 'Basic Data');
    const product = basic.fields.find((field) => field.technicalName === 'PRODUCT');
    const mtart = basic.fields.find((field) => field.technicalName === 'MTART');
    const attyp = basic.fields.find((field) => field.technicalName === 'ATTYP');
    assert.equal(product.valueHelpKey || '', '');
    assert.equal(mtart.valueHelpKey, 'T134-MTART');
    assert.equal(attyp.valueHelpKey || '', '');
    assert.deepEqual(
      parsed.valueHelps['T134-MTART'].map((item) => item.key),
      ['HAWA', 'FERT']
    );
    assert.equal(parsed.valueHelps['T134-MTART'][0].text, 'Trading Goods');
    assert.equal(parsed.sheets.find((sheet) => sheet.sheetType === 'ValueHelp').name, 'PV MM - Product');
  });

  it('reads hidden XML PV sheets and hidden row 3 for dropdowns', () => {
    const xmlPath = path.join(__dirname, 'fixtures', 'Product_hidden_pv.xml');
    const workbook = parseSpreadsheetML(fs.readFileSync(xmlPath));
    assert.ok(workbook.sheetNames.includes('PV MM - Product'));
    assert.equal(workbook.sheets['Basic Data'][2][1], 'T134-MTART');
    assert.equal(workbook.sheets['PV MM - Product'][0][0], 'T134');
    assert.equal(workbook.sheets['PV MM - Product'][1][0], 'MTART');
    assert.match(workbook.sheets['PV MM - Product'][2][0], /HAWA=>/);

    const parsed = parseMigrationExcel(fs.readFileSync(xmlPath), 'Product_hidden_pv.xml');
    const basic = parsed.sheets.find((sheet) => sheet.name === 'Basic Data');
    const mtart = basic.fields.find((field) => field.technicalName === 'MTART');
    const attyp = basic.fields.find((field) => field.technicalName === 'ATTYP');
    const product = basic.fields.find((field) => field.technicalName === 'PRODUCT');
    assert.equal(mtart.valueHelpKey, 'T134-MTART');
    assert.equal(product.valueHelpKey || '', '');
    assert.equal(attyp.valueHelpKey || '', '');
    assert.equal(parsed.valueHelps['T134-MTART'][0].key, 'HAWA');
    assert.equal(parsed.valueHelps['T134-MTART'][0].text, 'Trading Goods');
  });

  it('applies bundled Product value lists to cockpit XML with empty row 3 and no PV tab', () => {
    const xmlPath = path.join(
      __dirname,
      '..',
      'app',
      'migration-studio',
      'webapp',
      'sample',
      'Product.xml'
    );
    const parsed = parseMigrationExcel(fs.readFileSync(xmlPath), 'Product.xml');
    const basic = parsed.sheets.find((sheet) => sheet.name === 'Basic Data');
    const mtart = basic.fields.find((field) => field.technicalName === 'MTART');
    const attyp = basic.fields.find((field) => field.technicalName === 'ATTYP');
    const product = basic.fields.find((field) => field.technicalName === 'PRODUCT');
    assert.equal(mtart.valueHelpKey, 'T134-MTART');
    assert.equal(product.valueHelpKey || '', '');
    assert.equal(attyp.valueHelpKey || '', '');
    const extraProduct = parsed.sheets
      .filter((sheet) => sheet.sheetType === 'Data')
      .flatMap((sheet) => sheet.fields.filter((field) => field.technicalName === 'PRODUCT'));
    assert.ok(extraProduct.length > 1);
    assert.ok(extraProduct.every((field) => !field.valueHelpKey));
    assert.ok(parsed.valueHelps['T134-MTART'].some((item) => item.key === 'HAWA'));
    assert.ok(!parsed.sheets.some((sheet) => sheet.sheetType === 'ValueHelp'));
  });

  it('never binds a dropdown to PRODUCT even when row 3 is MARA-MATNR', () => {
    const helps = { 'MARA-MATNR': [{ key: '1000', text: 'Existing material' }], 'T134-MTART': [{ key: 'HAWA', text: 'Trading Goods' }] };
    const fieldKeys = { 'Basic Data::PRODUCT': 'MARA-MATNR', 'Basic Data::MTART': 'T134-MTART', 'Plant Data::PRODUCT': 'MARA-MATNR' };
    assert.equal(resolveValueHelpKey('MARA-MATNR', 'Basic Data', 'PRODUCT', fieldKeys, helps), '');
    assert.equal(resolveValueHelpKey('', 'Basic Data', 'PRODUCT', fieldKeys, helps), '');
    assert.equal(resolveValueHelpKey('T134-MTART', 'Basic Data', 'MTART', fieldKeys, helps), 'T134-MTART');
    assert.equal(resolveValueHelpKey('T134-MTART', 'Plant Data', 'MTART', fieldKeys, helps), 'T134-MTART');
    assert.equal(resolveValueHelpKey('MARA-MATNR', 'Plant Data', 'PRODUCT', fieldKeys, helps), '');
    assert.equal(resolveValueHelpKey('MARA-MATNR', 'Additional Descriptions', 'PRODUCT', fieldKeys, helps, 'Product Number'), '');
  });

  it('does not attach Product value lists to unrelated XML templates', () => {
    const parsed = parseMigrationExcel(fs.readFileSync(FIXTURE_XML), 'Source_data_for_Bank.xml');
    assert.equal(Object.keys(parsed.valueHelps || {}).length, 0);
    const master = parsed.sheets.find((sheet) => sheet.name === 'Bank Master');
    assert.equal(master.fields[0].valueHelpKey || '', '');
  });
});
