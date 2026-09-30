'use strict';

function isSpreadsheetML(buffer) {
  if (!buffer) return false;
  const head = Buffer.isBuffer(buffer) ? buffer.slice(0, 400).toString('utf8') : String(buffer).slice(0, 400);
  return head.includes('Workbook') && (head.includes('Excel.Sheet') || head.includes('spreadsheet'));
}

function xmlFileName(fileName) {
  const base = String(fileName || 'template').replace(/\.(xlsx|xlsm|xls|xml)$/i, '');
  return `${base || 'template'}.xml`;
}

function exportTemplateXml(template, sheets) {
  const original = toBuffer(template && template.content);
  const ordered = (sheets || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  if (isSpreadsheetML(original)) {
    return patchSpreadsheetML(original.toString('utf8').replace(/^\uFEFF/, ''), ordered);
  }
  return buildSpreadsheetML(template, ordered);
}

function toBuffer(content) {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content;
  if (content.type === 'Buffer' && Array.isArray(content.data)) return Buffer.from(content.data);
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(content);
}

function patchSpreadsheetML(xml, sheets) {
  const byName = new Map((sheets || []).map((sheet) => [sheet.name, sheet]));
  return xml.replace(/<Worksheet\b[\s\S]*?<\/Worksheet>/g, (block) => {
    const name = worksheetName(block);
    const sheet = byName.get(name);
    if (!sheet) return block;
    return block.replace(/<Table\b[\s\S]*?<\/Table>/, (table) => patchTable(table, sheet));
  });
}

function worksheetName(block) {
  const ss = block.match(/\bss:Name="([^"]+)"/);
  if (ss) return ss[1];
  const plain = block.match(/\bName="([^"]+)"/);
  return plain ? plain[1] : '';
}

function patchTable(tableXml, sheet) {
  const openEnd = tableXml.indexOf('>');
  const openTag = tableXml.slice(0, openEnd + 1);
  const inner = tableXml.slice(openEnd + 1, tableXml.lastIndexOf('</Table>'));
  const rows = splitRows(inner);
  const keep = keepRowCount(sheet);
  const prefix = inner.slice(0, rows[0] ? inner.indexOf(rows[0]) : inner.length);
  const kept = rows.slice(0, keep);
  const generated = dataRowXml(sheet);
  const combined = kept.length + generated.length;
  const nextOpen = setExpandedRowCount(openTag, combined);
  return `${nextOpen}${prefix}${kept.join('')}${generated.join('')}</Table>`;
}

function keepRowCount(sheet) {
  if (sheet.sheetType === 'Introduction') return 0;
  if (sheet.sheetType === 'FieldList') return 1;
  return 8;
}

function splitRows(inner) {
  const rows = [];
  let i = 0;
  while (i < inner.length) {
    const start = inner.indexOf('<Row', i);
    if (start < 0) break;
    const after = inner.slice(start, start + 8);
    if (!/^<Row[\s>/]/.test(after)) {
      i = start + 4;
      continue;
    }
    const selfClose = inner.indexOf('/>', start);
    const openEnd = inner.indexOf('>', start);
    if (selfClose >= 0 && selfClose < openEnd) {
      rows.push(inner.slice(start, selfClose + 2));
      i = selfClose + 2;
      continue;
    }
    const close = inner.indexOf('</Row>', start);
    if (close < 0) break;
    rows.push(inner.slice(start, close + 6));
    i = close + 6;
  }
  return rows;
}

function setExpandedRowCount(openTag, count) {
  if (/\bss:ExpandedRowCount="\d+"/.test(openTag)) {
    return openTag.replace(/\bss:ExpandedRowCount="\d+"/, `ss:ExpandedRowCount="${count}"`);
  }
  if (/\bExpandedRowCount="\d+"/.test(openTag)) {
    return openTag.replace(/\bExpandedRowCount="\d+"/, `ExpandedRowCount="${count}"`);
  }
  return openTag;
}

function dataRowXml(sheet) {
  if (sheet.sheetType === 'Introduction') {
    return introRows(sheet.introText).map(rowXml);
  }
  const rows = (sheet.rows || []).slice().sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));
  return rows.map((row) => rowXml(valuesForExport(sheet, row)));
}

function introRows(introText) {
  const lines = String(introText || '').split(/\r?\n/);
  if (!lines.length || (lines.length === 1 && !lines[0])) return [['']];
  return lines.map((line) => [line]);
}

function valuesForExport(sheet, row) {
  let raw = [];
  try {
    raw = JSON.parse(row.values || '[]');
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
  if (!fields.length) return raw;
  const width = Math.max(sheet.columnCount || 0, fields[fields.length - 1].columnIndex + 1, raw.length);
  const out = Array(width).fill('');
  if (raw.length === fields.length) {
    fields.forEach((field, index) => {
      out[field.columnIndex] = raw[index] == null ? '' : raw[index];
    });
    return out;
  }
  for (let i = 0; i < raw.length && i < out.length; i++) out[i] = raw[i] == null ? '' : raw[i];
  return out;
}

function rowXml(values) {
  const cells = (values || [])
    .map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`)
    .join('');
  return `<Row>${cells}</Row>\n`;
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSpreadsheetML(template, sheets) {
  const worksheets = (sheets || []).map(buildWorksheet).join('\n');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheets}
</Workbook>
`;
}

function buildWorksheet(sheet) {
  const name = escapeXml(sheet.name || 'Sheet');
  let rows = [];
  if (sheet.sheetType === 'Introduction') {
    rows = introRows(sheet.introText).map(rowXml);
  } else if (sheet.sheetType === 'FieldList') {
    const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
    const header = fields.length
      ? fields.map((field) => field.description || field.technicalName)
      : ['Sheet Name', 'Group Name', 'Field Description', 'Technical Name', 'Type', 'Length', 'Decimals', 'Mandatory', 'Key'];
    rows = [rowXml(header)].concat(dataRowXml(sheet));
  } else {
    const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
    const structure = fields.map((field) => sheet.structureName || '');
    const technical = fields.map((field) => field.technicalName + (field.isKey ? ' (k)' : ''));
    const types = fields.map((field) => [field.dataType, field.length].filter(Boolean).join(' '));
    const groups = fields.map((field) => field.groupName || '');
    const descriptions = fields.map(
      (field) => (field.description || '') + (field.mandatory ? ' *' : '')
    );
    rows = [
      rowXml([sheet.title || sheet.name]),
      rowXml([sheet.isMandatory ? 'Mandatory sheet' : '']),
      rowXml(['']),
      rowXml(structure),
      rowXml(technical),
      rowXml(types),
      rowXml(groups),
      rowXml(descriptions)
    ].concat(dataRowXml(sheet));
  }
  return `  <Worksheet ss:Name="${name}">
   <Table>
${rows.join('')}   </Table>
  </Worksheet>`;
}

module.exports = {
  exportTemplateXml,
  xmlFileName,
  isSpreadsheetML,
  valuesForExport
};
