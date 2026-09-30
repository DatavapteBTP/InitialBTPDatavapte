'use strict';

const XLSX = require('xlsx');
const { parseSpreadsheetML } = require('./spreadsheetml');

const INTRO_RE = /intro|instruction/i;
const FIELD_LIST_RE = /field\s*list|^fields$/i;
const VALUE_HELP_RE = /^pv\b|possible\s*values|value\s*help/i;
const MANDATORY_MARK_RE = /\*/;
const KEY_MARK_RE = /\bk\b|\(k\)/i;

/**
 * Parse an SAP Data Migration Cockpit template (xlsx, xlsm, SpreadsheetML 2003 XML)
 * or a generic multi-sheet workbook into a CAP-ready composition tree.
 */
function parseMigrationExcel(buffer, fileName = 'template.xlsx') {
  const workbook = readWorkbook(buffer, fileName);
  const sheetNames = workbook.sheetNames || [];
  if (!sheetNames.length) {
    throw Object.assign(new Error('The uploaded file has no worksheets.'), { status: 400 });
  }

  const rawSheets = sheetNames.map((name) => ({
    name,
    rows: workbook.sheets[name] || []
  }));

  const fieldListSheet = rawSheets.find((s) => FIELD_LIST_RE.test(s.name));
  const fieldCatalog = fieldListSheet ? indexFieldList(fieldListSheet.rows) : new Map();
  let valueHelps = indexPossibleValues(rawSheets);
  let fieldKeys = {};
  // Cockpit XML omits the hidden PV sheet and leaves row 3 empty. Reuse the
  // Product xlsx catalog and match by sheet + technical field name.
  if (!Object.keys(valueHelps).length && looksLikeProductWorkbook(fileName, rawSheets)) {
    const bundled = loadBundledProductValueHelps();
    valueHelps = bundled.valueHelps || {};
    fieldKeys = bundled.fieldKeys || {};
  }

  const sheets = rawSheets.map((raw, sequence) =>
    buildSheet(raw, sequence, fieldCatalog, fieldKeys, valueHelps)
  );
  const objectName = inferObjectName(fileName, sheets);
  const fieldCount = sheets.reduce((n, s) => n + s.fields.length, 0);
  const rowCount = sheets.reduce((n, s) => n + s.rows.length, 0);
  const valueHelpCount = Object.keys(valueHelps).length;
  const helpNote = valueHelpCount
    ? `, ${valueHelpCount} value list${valueHelpCount === 1 ? '' : 's'}`
    : '';

  return {
    fileName,
    objectName,
    status: 'Parsed',
    sheetCount: sheets.length,
    fieldCount,
    rowCount,
    valueHelps,
    parseMessage: `Read ${sheets.length} tab${sheets.length === 1 ? '' : 's'}, ${fieldCount} fields, ${rowCount} data rows${helpNote}.`,
    sheets
  };
}

function readWorkbook(buffer, fileName) {
  const looksXml =
    /\.xml$/i.test(fileName) ||
    buffer.slice(0, 200).toString('utf8').includes('urn:schemas-microsoft-com:office:spreadsheet') ||
    buffer.slice(0, 200).toString('utf8').includes('Excel.Sheet');

  if (looksXml) {
    try {
      return parseSpreadsheetML(buffer);
    } catch (xmlError) {
      try {
        return workbookFromSheetJS(buffer);
      } catch {
        throw Object.assign(
          new Error(`Could not read SpreadsheetML template: ${xmlError.message}`),
          { status: 400 }
        );
      }
    }
  }

  try {
    return workbookFromSheetJS(buffer);
  } catch (error) {
    if (buffer.slice(0, 200).toString('utf8').includes('<Workbook')) {
      return parseSpreadsheetML(buffer);
    }
    throw Object.assign(new Error(`Could not read Excel file: ${error.message}`), { status: 400 });
  }
}

function workbookFromSheetJS(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    compactSheetRef(sheet);
    // Keep blank metadata rows so Migration Cockpit row 4–8 indexes stay aligned.
    // compactSheetRef already stops SheetJS from materializing phantom used ranges.
    sheets[name] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false
    });
  }
  return { sheetNames: wb.SheetNames, sheets };
}

const MAX_SHEET_ROWS = 20000;
const MAX_SHEET_COLS = 400;

/**
 * Excel often stores a phantom used range (e.g. A1:ALW100011). SheetJS then
 * materializes hundreds of thousands of empty cells and the upload times out,
 * which the UI reports as a JSON parse error.
 */
function compactSheetRef(sheet) {
  if (!sheet || typeof sheet !== 'object') return sheet;
  let maxR = 0;
  let maxC = 0;
  let found = false;
  for (const key of Object.keys(sheet)) {
    if (key.charAt(0) === '!') continue;
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r > MAX_SHEET_ROWS || cell.c > MAX_SHEET_COLS) continue;
    found = true;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: found ? maxR : 0, c: found ? maxC : 0 }
  });
  return sheet;
}

function buildSheet(raw, sequence, fieldCatalog, fieldKeys, valueHelps) {
  const sheetType = detectSheetType(raw.name);
  const base = {
    name: raw.name,
    title: raw.name,
    sheetType,
    sequence,
    isMandatory: false,
    structureName: '',
    columnCount: 0,
    dataRowCount: 0,
    introText: '',
    fields: [],
    rows: []
  };

  if (sheetType === 'Introduction') {
    base.introText = rowsToIntroText(raw.rows);
    return base;
  }

  if (sheetType === 'FieldList') {
    return Object.assign(base, parseFieldListSheet(raw.rows));
  }

  if (sheetType === 'ValueHelp') {
    return Object.assign(base, parsePossibleValuesSheet(raw.rows));
  }

  return Object.assign(base, parseDataSheet(raw, fieldCatalog, fieldKeys, valueHelps));
}

function detectSheetType(name) {
  if (INTRO_RE.test(name)) return 'Introduction';
  if (FIELD_LIST_RE.test(name)) return 'FieldList';
  if (VALUE_HELP_RE.test(name)) return 'ValueHelp';
  return 'Data';
}

function parseDataSheet(raw, fieldCatalog, fieldKeys, valueHelps) {
  const rows = raw.rows || [];
  const format = detectDataFormat(rows);

  if (format === 'migration') {
    return parseMigrationDataSheet(raw, rows, fieldCatalog, fieldKeys, valueHelps);
  }
  return parseGenericDataSheet(raw, rows);
}

/**
 * SAP Migration Cockpit XML/Excel data sheets:
 *   row 4 (index 3) technical structure name
 *   row 5 (index 4) technical field names
 *   row 6 (index 5) data type / length
 *   row 8 (index 7) field descriptions (* = mandatory)
 *   row 9+          business data
 */
function parseMigrationDataSheet(raw, rows, fieldCatalog, fieldKeys, valueHelps) {
  const checkTableRow = normalizeRow(rows[2]);
  const structureRow = normalizeRow(rows[3]);
  const technicalRow = normalizeRow(rows[4]);
  const typeRow = normalizeRow(rows[5]);
  const groupRow = normalizeRow(rows[6]);
  const descriptionRow = normalizeRow(rows[7]);
  const columnCount = Math.max(
    descriptionRow.length,
    technicalRow.length,
    typeRow.length,
    groupRow.length,
    checkTableRow.length
  );

  const structureName =
    firstNonEmpty(structureRow) ||
    firstNonEmpty(rows[0]) ||
    raw.name;

  const fields = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const description = String(descriptionRow[columnIndex] || '').trim();
    const technicalName = String(technicalRow[columnIndex] || '').trim();
    const typeInfo = parseTypeLength(typeRow[columnIndex]);
    const groupName = String(groupRow[columnIndex] || structureRow[columnIndex] || '').trim();
    if (!description && !technicalName) continue;

    const catalog = lookupCatalog(fieldCatalog, raw.name, technicalName, description);
    const mandatory =
      MANDATORY_MARK_RE.test(description) ||
      MANDATORY_MARK_RE.test(technicalName) ||
      Boolean(catalog?.mandatory);
    const isKey = KEY_MARK_RE.test(technicalName) || Boolean(catalog?.isKey);

    fields.push(fitField({
      columnIndex,
      technicalName: stripMarks(technicalName) || catalog?.technicalName || `COL_${columnIndex + 1}`,
      description: stripMarks(description) || catalog?.description || stripMarks(technicalName),
      dataType: typeInfo.dataType || catalog?.dataType || '',
      length: typeInfo.length || catalog?.length || '',
      decimals: typeInfo.decimals || catalog?.decimals || '',
      mandatory,
      isKey,
      groupName: groupName || catalog?.groupName || '',
      sapFieldName: catalog?.sapFieldName || stripMarks(technicalName),
      valueHelpKey: resolveValueHelpKey(
        checkTableRow[columnIndex],
        raw.name,
        stripMarks(technicalName) || catalog?.technicalName || '',
        fieldKeys,
        valueHelps,
        stripMarks(description) || catalog?.description || ''
      )
    }));
  }

  const dataRows = [];
  for (let r = 8; r < rows.length; r++) {
    const values = normalizeRow(rows[r], columnCount);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  const isMandatory = /general|master|basic/i.test(raw.name);

  return {
    title: firstNonEmpty(rows[0]) || raw.name,
    isMandatory,
    structureName,
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function parseGenericDataSheet(raw, rows) {
  const headerIndex = rows.findIndex((row) => normalizeRow(row).some((c) => String(c).trim()));
  if (headerIndex < 0) {
    return { title: raw.name, fields: [], rows: [], columnCount: 0, dataRowCount: 0 };
  }

  const headers = normalizeRow(rows[headerIndex]);
  const fields = headers
    .map((header, columnIndex) => {
      const description = String(header || '').trim();
      if (!description) return null;
      return fitField({
        columnIndex,
        technicalName: slugField(description, columnIndex),
        description: stripMarks(description),
        dataType: '',
        length: '',
        decimals: '',
        mandatory: MANDATORY_MARK_RE.test(description),
        isKey: KEY_MARK_RE.test(description),
        groupName: raw.name,
        sapFieldName: ''
      });
    })
    .filter(Boolean);

  const columnCount = headers.length;
  const dataRows = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r], columnCount);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  return {
    title: raw.name,
    structureName: raw.name,
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function parseFieldListSheet(rows) {
  const headerIndex = findFieldListHeaderIndex(rows);
  if (headerIndex < 0) {
    return { fields: [], rows: [], columnCount: 0, dataRowCount: 0, introText: '' };
  }

  const headers = normalizeRow(rows[headerIndex]).map((h) => String(h || '').trim());
  const fields = headers
    .map((description, columnIndex) => {
      if (!description) return null;
      return fitField({
        columnIndex,
        technicalName: slugField(description, columnIndex),
        description,
        dataType: 'Text',
        length: '',
        decimals: '',
        mandatory: false,
        isKey: false,
        groupName: 'Field List',
        sapFieldName: ''
      });
    })
    .filter(Boolean);

  const dataRows = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r], headers.length);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  return {
    title: 'Field List',
    structureName: 'FieldList',
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function parsePossibleValuesSheet(rows) {
  const tables = normalizeRow(rows[0]);
  const names = normalizeRow(rows[1]);
  const columnCount = Math.max(tables.length, names.length);
  const fields = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const table = String(tables[columnIndex] || '').trim();
    const fieldName = String(names[columnIndex] || '').trim();
    if (!table && !fieldName) continue;
    fields.push(fitField({
      columnIndex,
      technicalName: fieldName || `COL_${columnIndex + 1}`,
      description: [table, fieldName].filter(Boolean).join('-'),
      dataType: 'Text',
      length: '',
      decimals: '',
      mandatory: false,
      isKey: false,
      groupName: 'Possible Values',
      sapFieldName: fieldName,
      valueHelpKey: table && fieldName ? `${table}-${fieldName}` : ''
    }));
  }

  const dataRows = [];
  for (let r = 2; r < (rows || []).length; r++) {
    const values = normalizeRow(rows[r], columnCount);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  return {
    title: 'Possible Values',
    structureName: 'PossibleValues',
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function indexPossibleValues(rawSheets) {
  const catalog = {};
  const pv = (rawSheets || []).find((sheet) => VALUE_HELP_RE.test(sheet.name));
  if (!pv) return catalog;
  const rows = pv.rows || [];
  const tables = normalizeRow(rows[0]);
  const names = normalizeRow(rows[1]);
  const columnCount = Math.max(tables.length, names.length);
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const table = String(tables[columnIndex] || '').trim();
    const fieldName = String(names[columnIndex] || '').trim();
    if (!table || !fieldName) continue;
    const options = [];
    const seen = new Set();
    for (let r = 2; r < rows.length; r++) {
      const raw = String(normalizeRow(rows[r])[columnIndex] || '').trim();
      if (!raw || /^no data found$/i.test(raw)) continue;
      const entry = parseValueHelpEntry(raw);
      if (!entry.key || seen.has(entry.key)) continue;
      seen.add(entry.key);
      options.push(entry);
    }
    if (options.length) catalog[`${table}-${fieldName}`] = options;
  }
  return catalog;
}

function parseValueHelpEntry(value) {
  const text = String(value || '').trim();
  const idx = text.indexOf('=>');
  if (idx >= 0) {
    return {
      key: text.slice(0, idx).trim(),
      text: text.slice(idx + 2).trim()
    };
  }
  return { key: text, text: text };
}

function lookupValueHelp(catalog, tableField) {
  if (!catalog || !tableField) return [];
  const direct = catalog[tableField];
  if (direct && direct.length) return direct;
  const needle = String(tableField).toUpperCase();
  for (const [key, options] of Object.entries(catalog)) {
    if (key.toUpperCase() === needle && options && options.length) return options;
  }
  return [];
}

let bundledProductValueHelps = null;

function loadBundledProductValueHelps() {
  if (bundledProductValueHelps) return bundledProductValueHelps;
  try {
    bundledProductValueHelps = require('./product-value-helps.json');
  } catch {
    bundledProductValueHelps = { valueHelps: {}, fieldKeys: {} };
  }
  return bundledProductValueHelps;
}

function looksLikeProductWorkbook(fileName, rawSheets) {
  if (/product/i.test(String(fileName || ''))) return true;
  const sheets = rawSheets || [];
  if (!sheets.some((sheet) => sheet.name === 'Basic Data')) return false;
  return sheets.some((sheet) => {
    const tech = normalizeRow(sheet.rows && sheet.rows[4]);
    return tech.some((cell) => /^(PRODUCT|MTART)$/i.test(String(cell || '').trim()));
  });
}

function isFreeTextProductField(sheetName, technicalName, description) {
  const tech = String(technicalName || '').trim();
  if (/^PRODUCT$/i.test(tech)) return true;
  return /product\s*number/i.test(String(description || ''));
}

function resolveValueHelpKey(row3, sheetName, technicalName, fieldKeys, valueHelps, description) {
  // Product Number is typed by the user; do not bind MARA-MATNR on any sheet.
  if (isFreeTextProductField(sheetName, technicalName, description)) return '';
  const fromRow = String(row3 || '').trim();
  if (fromRow) return fromRow;
  const tech = stripMarks(technicalName);
  if (!tech) return '';
  const mapped = fieldKeys && (fieldKeys[`${sheetName}::${tech}`] || fieldKeys[`${sheetName}::${tech.toUpperCase()}`]);
  if (mapped && valueHelps && valueHelps[mapped] && valueHelps[mapped].length) return mapped;
  const needle = tech.toUpperCase();
  const matches = Object.keys(valueHelps || {}).filter((key) => {
    const upper = key.toUpperCase();
    return upper === needle || upper.endsWith(`-${needle}`);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    matches.sort((a, b) => (valueHelps[b] || []).length - (valueHelps[a] || []).length);
    return matches[0];
  }
  return '';
}

function findFieldListHeaderIndex(rows) {
  return (rows || []).findIndex((row) => {
    const joined = normalizeRow(row)
      .map((cell) => String(cell || '').toLowerCase())
      .join(' | ');
    return joined.includes('sheet') && (joined.includes('field description') || joined.includes('description'));
  });
}

function indexFieldList(rows) {
  const catalog = new Map();
  const headerIndex = findFieldListHeaderIndex(rows);
  if (headerIndex < 0) return catalog;

  const headers = normalizeRow(rows[headerIndex]).map((h) => String(h || '').trim().toLowerCase());
  const col = (aliases) => headers.findIndex((h) => aliases.some((a) => h === a || h.includes(a)));

  const sheetCol = col(['sheet name', 'sheet']);
  const groupCol = col(['group name', 'group']);
  const descCol = col(['field description', 'description', 'field name', 'label']);
  const techCol = col(['technical name', 'technical', 'sap field']);
  const typeCol = col(['data type', 'type']);
  const lengthCol = col(['length']);
  const decCol = col(['decimal']);
  const mandCol = col(['importance', 'mandatory', 'required']);
  const keyCol = col(['key']);

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r]);
    const technicalName = stripMarks(values[techCol] || '');
    const description = stripMarks(values[descCol] || '');
    if (!technicalName && !description) continue;
    const entry = {
      sheetName: String(values[sheetCol] || '').trim(),
      groupName: String(values[groupCol] || '').trim(),
      description,
      technicalName,
      dataType: String(values[typeCol] || '').trim(),
      length: String(values[lengthCol] || '').trim(),
      decimals: String(values[decCol] || '').trim(),
      mandatory: isTruthyFlag(values[mandCol]),
      isKey: isTruthyFlag(values[keyCol]),
      sapFieldName: technicalName
    };
    if (technicalName) catalog.set(`${entry.sheetName}::${technicalName}`.toLowerCase(), entry);
    if (description) catalog.set(`${entry.sheetName}::${description}`.toLowerCase(), entry);
  }
  return catalog;
}

function lookupCatalog(catalog, sheetName, technicalName, description) {
  if (!catalog || !catalog.size) return null;
  const keys = [
    `${sheetName}::${stripMarks(technicalName)}`,
    `${sheetName}::${stripMarks(description)}`
  ];
  for (const key of keys) {
    const hit = catalog.get(key.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function detectDataFormat(rows) {
  if (!rows || rows.length < 8) return 'generic';
  const technicalRow = normalizeRow(rows[4]);
  const typeRow = normalizeRow(rows[5]);
  const descriptionRow = normalizeRow(rows[7]);
  const techHits = technicalRow.filter((c) => /^[A-Z][A-Z0-9_/]{1,30}$/.test(String(c).trim())).length;
  const typeHits = typeRow.filter((c) =>
    /char|numc|dec|date|clnt|cuky|curr|tims|lang|text|number|integer|ete\s*;/i.test(String(c))
  ).length;
  const descHits = descriptionRow.filter((c) => String(c).trim()).length;
  if ((techHits >= 2 && descHits >= 2) || (typeHits >= 2 && descHits >= 2)) return 'migration';
  return 'generic';
}

function parseTypeLength(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return { dataType: '', length: '', decimals: '' };
  const coded = text.match(/^([A-Za-z]+)\s*;\s*(\d+)\s*;\s*(\d+)/);
  if (coded) {
    return {
      dataType: coded[1].toUpperCase(),
      length: coded[2],
      decimals: coded[3] === '0' ? '' : coded[3]
    };
  }
  const match = text.match(/^([A-Za-z]+)\s*(\d+)?(?:\s*[.,/]\s*(\d+))?/);
  if (match) {
    return {
      dataType: match[1].toUpperCase(),
      length: match[2] || '',
      decimals: match[3] || ''
    };
  }
  const lengthOnly = text.match(/length[:\s]+(\d+)/i);
  const typeOnly = text.match(/type[:\s]+([A-Za-z]+)/i);
  const decOnly = text.match(/dec(?:imal)?s?[:\s]+(\d+)/i);
  return {
    dataType: typeOnly ? typeOnly[1].toUpperCase() : text,
    length: lengthOnly ? lengthOnly[1] : '',
    decimals: decOnly ? decOnly[1] : ''
  };
}

function rowsToIntroText(rows) {
  return (rows || [])
    .map((row) => normalizeRow(row).filter(Boolean).join('  '))
    .filter((line) => line.trim())
    .join('\n');
}

function normalizeRow(row, minLength = 0) {
  const values = Array.isArray(row) ? row.map((cell) => stringifyCell(cell)) : [];
  while (values.length < minLength) values.push('');
  return values;
}

function stringifyCell(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) {
    const yyyy = cell.getFullYear();
    const mm = String(cell.getMonth() + 1).padStart(2, '0');
    const dd = String(cell.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(cell).trim();
}

function firstNonEmpty(row) {
  if (!row) return '';
  if (typeof row === 'string') return row.trim();
  const values = Array.isArray(row) ? row : [];
  return values.map((c) => String(c || '').trim()).find(Boolean) || '';
}

const FIELD_LIMITS = {
  technicalName: 128,
  description: 2000,
  dataType: 40,
  length: 20,
  decimals: 10,
  groupName: 255,
  sapFieldName: 128,
  valueHelpKey: 128
};

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function fitField(field) {
  const next = Object.assign({}, field);
  if (next.description) next.description = decodeXmlText(next.description);
  if (next.groupName) next.groupName = decodeXmlText(next.groupName);
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    if (next[key] != null) next[key] = String(next[key]).slice(0, max);
  }
  return next;
}

function stripMarks(value) {
  return String(value || '')
    .replace(/\s*\*\s*/g, ' ')
    .replace(/\s*\(k\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugField(description, columnIndex) {
  const slug = String(description || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return slug || `COL_${columnIndex + 1}`;
}

function isTruthyFlag(value) {
  const text = String(value || '').trim();
  if (/mandatory|required|\*/i.test(text)) return true;
  return /^(y|yes|true|1|x|k|key)$/i.test(text);
}

function inferObjectName(fileName, sheets) {
  const fromFile = String(fileName || '')
    .replace(/\.(xlsx|xlsm|xls|xml)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/^source data for\s+/i, '')
    .trim();
  if (fromFile && !/^template$/i.test(fromFile)) return fromFile;
  const dataSheet = sheets.find((s) => s.sheetType === 'Data');
  return dataSheet?.title || dataSheet?.name || 'Migration Template';
}

function gridFromSheet(sheet) {
  const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
  const rows = (sheet.rows || [])
    .slice()
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map((row) => {
      let values = [];
      try {
        values = JSON.parse(row.values || '[]');
      } catch {
        values = [];
      }
      return {
        rowIndex: row.rowIndex,
        cells: fields.map((field) => ({
          columnIndex: field.columnIndex,
          value: values[field.columnIndex] ?? ''
        }))
      };
    });

  return {
    ID: sheet.ID,
    name: sheet.name,
    title: sheet.title,
    sheetType: sheet.sheetType,
    isMandatory: sheet.isMandatory,
    structureName: sheet.structureName,
    introText: sheet.introText || '',
    fields,
    rows
  };
}

module.exports = {
  parseMigrationExcel,
  detectSheetType,
  detectDataFormat,
  parseTypeLength,
  parseValueHelpEntry,
  lookupValueHelp,
  resolveValueHelpKey,
  isFreeTextProductField,
  indexPossibleValues,
  gridFromSheet,
  readWorkbook,
  compactSheetRef,
  fitField
};
