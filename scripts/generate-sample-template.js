'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const INTRO = [
  ['SAP S/4HANA Migration Cockpit'],
  ['Source data for Bank'],
  [''],
  ['How to use this template'],
  ['1. Read the Field List tab for every field, data type, length, and mandatory indicator.'],
  ['2. Mandatory sheets are marked. Fill every mandatory field in a mandatory sheet.'],
  ['3. An asterisk (*) next to a field description means the field is mandatory.'],
  ['4. A (k) next to a technical name means the field is a key.'],
  ['5. Rows 4 to 6 are hidden technical metadata: structure name, field name, type/length.'],
  ['6. Row 8 contains the field description you maintain in the cockpit.'],
  ['7. Business data starts in row 9. Do not rename tabs or delete columns.']
];

const FIELD_LIST_HEADERS = [
  'Sheet Name',
  'Group Name',
  'Field Description',
  'Technical Name',
  'Type',
  'Length',
  'Decimals',
  'Mandatory',
  'Key'
];

const FIELD_LIST_ROWS = [
  ['Bank Master', 'Bank Data', 'Bank Country Key', 'BANKS', 'CHAR', '3', '', '*', 'k'],
  ['Bank Master', 'Bank Data', 'Bank Key', 'BANKL', 'CHAR', '15', '', '*', 'k'],
  ['Bank Master', 'Bank Data', 'Bank Name', 'BANKA', 'CHAR', '60', '', '*', ''],
  ['Bank Master', 'Bank Data', 'Region', 'REGIO', 'CHAR', '3', '', '', ''],
  ['Bank Master', 'Bank Data', 'Street', 'STRAS', 'CHAR', '35', '', '', ''],
  ['Bank Master', 'Bank Data', 'City', 'ORT01', 'CHAR', '35', '', '', ''],
  ['Bank Master', 'Bank Data', 'SWIFT/BIC', 'SWIFT', 'CHAR', '11', '', '', ''],
  ['Bank Master', 'Bank Data', 'Bank Number', 'BNKLZ', 'CHAR', '15', '', '', ''],
  ['Bank Address', 'Address', 'Bank Country Key', 'BANKS', 'CHAR', '3', '', '*', 'k'],
  ['Bank Address', 'Address', 'Bank Key', 'BANKL', 'CHAR', '15', '', '*', 'k'],
  ['Bank Address', 'Address', 'Language', 'SPRAS', 'LANG', '1', '', '', ''],
  ['Bank Address', 'Address', 'Address Line', 'ADRNR', 'CHAR', '80', '', '', '']
];

const BANK_MASTER = {
  row1: ['Source Data for Bank Master'],
  row2: ['Mandatory sheet — enter one row per bank'],
  row3: [],
  row4: ['S_BNKA', 'S_BNKA', 'S_BNKA', 'S_BNKA', 'S_BNKA', 'S_BNKA', 'S_BNKA', 'S_BNKA'],
  row5: ['BANKS (k)', 'BANKL (k)', 'BANKA', 'REGIO', 'STRAS', 'ORT01', 'SWIFT', 'BNKLZ'],
  row6: ['CHAR 3', 'CHAR 15', 'CHAR 60', 'CHAR 3', 'CHAR 35', 'CHAR 35', 'CHAR 11', 'CHAR 15'],
  row7: ['Bank Data', 'Bank Data', 'Bank Data', 'Bank Data', 'Bank Data', 'Bank Data', 'Bank Data', 'Bank Data'],
  row8: ['Bank Country Key *', 'Bank Key *', 'Bank Name *', 'Region', 'Street', 'City', 'SWIFT/BIC', 'Bank Number'],
  data: [
    ['DE', '20060001', 'City Bank', '06', 'Mainzer Landstrasse 16', 'Frankfurt', 'COBADEFFXXX', '20060001'],
    ['US', '121000248', 'Wells Fargo Bank', 'CA', '420 Montgomery St', 'San Francisco', 'WFBIUS6SXXX', '121000248'],
    ['IN', 'HDFC0000123', 'HDFC Bank', 'MH', 'Senapati Bapat Marg', 'Mumbai', 'HDFCINBBXXX', 'HDFC0000123']
  ]
};

const BANK_ADDRESS = {
  row1: ['Source Data for Bank Address'],
  row2: ['Optional sheet'],
  row3: [],
  row4: ['S_ADDR', 'S_ADDR', 'S_ADDR', 'S_ADDR'],
  row5: ['BANKS (k)', 'BANKL (k)', 'SPRAS', 'ADRNR'],
  row6: ['CHAR 3', 'CHAR 15', 'LANG 1', 'CHAR 80'],
  row7: ['Address', 'Address', 'Address', 'Address'],
  row8: ['Bank Country Key *', 'Bank Key *', 'Language', 'Address Line'],
  data: [
    ['DE', '20060001', 'D', 'City Bank Frankfurt HQ'],
    ['US', '121000248', 'E', 'Wells Fargo San Francisco']
  ]
};

function padSheet(meta) {
  return [
    meta.row1,
    meta.row2,
    meta.row3,
    meta.row4,
    meta.row5,
    meta.row6,
    meta.row7,
    meta.row8,
    ...meta.data
  ];
}

function writeXlsx(filePath) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(INTRO), 'Introduction');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([FIELD_LIST_HEADERS, ...FIELD_LIST_ROWS]), 'Field List');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(padSheet(BANK_MASTER)), 'Bank Master');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(padSheet(BANK_ADDRESS)), 'Bank Address');
  XLSX.writeFile(wb, filePath);
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlRow(cells) {
  const cellXml = cells
    .map((value) => `      <Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`)
    .join('\n');
  return `    <Row>\n${cellXml}\n    </Row>`;
}

function xmlSheet(name, rows) {
  const rowXml = rows.map(xmlRow).join('\n');
  return `  <Worksheet ss:Name="${xmlEscape(name)}">\n   <Table>\n${rowXml}\n   </Table>\n  </Worksheet>`;
}

function writeXml(filePath) {
  const xml = [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    xmlSheet('Introduction', INTRO),
    xmlSheet('Field List', [FIELD_LIST_HEADERS, ...FIELD_LIST_ROWS]),
    xmlSheet('Bank Master', padSheet(BANK_MASTER)),
    xmlSheet('Bank Address', padSheet(BANK_ADDRESS)),
    '</Workbook>',
    ''
  ].join('\n');
  fs.writeFileSync(filePath, xml, 'utf8');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const targets = [
  path.join(__dirname, '..', 'test', 'fixtures', 'Source_data_for_Bank.xlsx'),
  path.join(__dirname, '..', 'test', 'fixtures', 'Source_data_for_Bank.xml'),
  path.join(__dirname, '..', 'app', 'migration-studio', 'webapp', 'sample', 'Source_data_for_Bank.xml')
];

ensureDir(targets[0]);
writeXlsx(targets[0]);
writeXml(targets[1]);
ensureDir(targets[2]);
writeXml(targets[2]);

console.log('Wrote sample templates:');
for (const target of targets) {
  console.log(' -', target);
}

module.exports = { INTRO, FIELD_LIST_ROWS, BANK_MASTER, BANK_ADDRESS };
