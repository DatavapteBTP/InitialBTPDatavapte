using { datavapte.migration as db } from '../db/schema';

service MigrationService {

  @odata.draft.enabled: false
  entity Templates as projection on db.Templates;

  entity Sheets as projection on db.Sheets;

  entity Fields as projection on db.Fields;

  entity DataRows as projection on db.DataRows;

  action uploadTemplate(
    fileName  : String,
    mediaType : String,
    content   : LargeString
  ) returns Templates;

  function sheetGrid(sheetId : UUID) returns LargeString;

  action saveSheetData(
    sheetId   : UUID,
    introText : LargeString,
    rows      : LargeString
  ) returns Integer;
}
