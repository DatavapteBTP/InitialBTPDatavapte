using { cuid, managed } from '@sap/cds/common';

namespace datavapte.migration;

entity Templates : cuid, managed {
  fileName      : String(255);
  mediaType     : String(128);
  fileSize      : Integer;
  objectName    : String(255);
  status        : String(20) default 'Uploaded';
  sheetCount    : Integer default 0;
  fieldCount    : Integer default 0;
  rowCount      : Integer default 0;
  parseMessage  : String(2000);
  @Core.MediaType: mediaType
  @Core.ContentDisposition.Filename: fileName
  content       : LargeBinary;
  sheets        : Composition of many Sheets on sheets.template = $self;
}

entity Sheets : cuid {
  template      : Association to Templates;
  name          : String(255);
  title         : String(255);
  sheetType     : String(20);
  sequence      : Integer;
  isMandatory   : Boolean default false;
  structureName : String(255);
  columnCount   : Integer default 0;
  dataRowCount  : Integer default 0;
  introText     : LargeString;
  fields        : Composition of many Fields on fields.sheet = $self;
  rows          : Composition of many DataRows on rows.sheet = $self;
}

entity Fields : cuid {
  sheet          : Association to Sheets;
  columnIndex    : Integer;
  technicalName  : String(128);
  description    : String(512);
  dataType       : String(40);
  length         : String(20);
  decimals       : String(10);
  mandatory      : Boolean default false;
  isKey          : Boolean default false;
  groupName      : String(255);
  sapFieldName   : String(128);
}

entity DataRows : cuid {
  sheet    : Association to Sheets;
  rowIndex : Integer;
  values   : LargeString;
}
