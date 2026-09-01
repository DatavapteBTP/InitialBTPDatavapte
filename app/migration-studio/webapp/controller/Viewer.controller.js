sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/Button",
  "sap/m/MessageBox"
], function (Controller, Button, MessageBox) {
  "use strict";

  return Controller.extend("datavapte.migration.studio.controller.Viewer", {
    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("viewer")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("home");
    },

    onRouteMatched: function (oEvent) {
      const templateId = oEvent.getParameter("arguments").templateId;
      this._loadTemplate(templateId);
    },

    _loadTemplate: function (templateId) {
      const oApp = this.getOwnerComponent().getModel("app");
      oApp.setProperty("/busy", true);
      const url = "/odata/v4/migration/Templates(" + templateId + ")" +
        "?$expand=sheets($expand=fields,rows;$orderby=sequence)";
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error("Template could not be loaded.");
          return res.json();
        })
        .then((template) => {
          if (template.sheets && template.sheets.length) {
            template.sheets.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          }
          oApp.setProperty("/current", template);
          oApp.setProperty("/busy", false);
          this._renderSheetTabs(template.sheets || []);
          const firstData = (template.sheets || []).find((s) => s.sheetType === "Data")
            || (template.sheets || [])[0];
          if (firstData) {
            this._showSheet(firstData.ID);
          }
        })
        .catch((err) => {
          oApp.setProperty("/busy", false);
          MessageBox.error(err.message);
        });
    },

    _renderSheetTabs: function (sheets) {
      const oBox = this.byId("sheetTabs");
      oBox.removeAllItems();
      sheets.forEach((sheet) => {
        const oBtn = new Button({
          text: sheet.name + (sheet.isMandatory ? " *" : ""),
          type: sheet.ID === this._activeSheetId ? "Emphasized" : "Transparent",
          tooltip: sheet.sheetType + (sheet.structureName ? " · " + sheet.structureName : ""),
          press: this._showSheet.bind(this, sheet.ID)
        });
        oBtn.addStyleClass("dmsSheetTab");
        if (sheet.isMandatory) {
          oBtn.addStyleClass("dmsSheetTabMandatory");
        }
        if (sheet.sheetType === "Introduction") {
          oBtn.addStyleClass("dmsSheetTabIntro");
        }
        oBtn.data("sheetId", sheet.ID);
        oBox.addItem(oBtn);
      });
    },

    _showSheet: function (sheetId) {
      const oApp = this.getOwnerComponent().getModel("app");
      const template = oApp.getProperty("/current");
      if (!template) return;
      const sheet = (template.sheets || []).find((s) => s.ID === sheetId);
      if (!sheet) return;
      this._activeSheetId = sheetId;
      this._renderSheetTabs(template.sheets || []);
      this._renderGrid(sheet);
    },

    _renderGrid: function (sheet) {
      const oHtml = this.byId("excelGrid");
      if (sheet.sheetType === "Introduction") {
        oHtml.setContent(renderIntroduction(sheet));
        return;
      }
      oHtml.setContent(renderSheetTable(sheet));
    }
  });

  function renderIntroduction(sheet) {
    const lines = String(sheet.introText || "")
      .split("\n")
      .map((line) => escapeHtml(line))
      .map((line) => "<p class=\"dmsIntroLine\">" + (line || "&nbsp;") + "</p>")
      .join("");
    return (
      "<div class=\"dmsIntro\">" +
        "<h2>" + escapeHtml(sheet.title || sheet.name) + "</h2>" +
        "<div class=\"dmsIntroBody\">" + (lines || "<p>No introduction text.</p>") + "</div>" +
      "</div>"
    );
  }

  function renderSheetTable(sheet) {
    const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
    const rows = (sheet.rows || []).slice().sort((a, b) => a.rowIndex - b.rowIndex);
    const showGroup = fields.some((f) => f.groupName);
    const showTech = fields.some((f) => f.technicalName);
    const showType = fields.some((f) => f.dataType || f.length);

    let html = "<div class=\"dmsExcel\">";
    html += "<div class=\"dmsExcelCaption\">" + escapeHtml(sheet.title || sheet.name);
    if (sheet.structureName) {
      html += " <span class=\"dmsExcelStructure\">" + escapeHtml(sheet.structureName) + "</span>";
    }
    if (sheet.isMandatory) html += " <span class=\"dmsBadge\">Mandatory sheet</span>";
    html += "</div><table class=\"dmsExcelTable\"><thead>";

    html += "<tr class=\"dmsRowLetters\"><th class=\"dmsRowHead\"></th>";
    fields.forEach((_, i) => {
      html += "<th>" + columnLetter(i) + "</th>";
    });
    html += "</tr>";

    if (showGroup) {
      html += "<tr class=\"dmsRowGroup\"><th class=\"dmsRowHead\">Group</th>";
      fields.forEach((f) => {
        html += "<th>" + escapeHtml(f.groupName || "") + "</th>";
      });
      html += "</tr>";
    }

    html += "<tr class=\"dmsRowDesc\"><th class=\"dmsRowHead\">Description</th>";
    fields.forEach((f) => {
      const mark = f.mandatory ? " <span class=\"dmsReq\">*</span>" : "";
      const key = f.isKey ? " <span class=\"dmsKey\">k</span>" : "";
      const cls = f.mandatory ? " class=\"dmsMandatory\"" : "";
      html += "<th" + cls + ">" + escapeHtml(f.description || "") + mark + key + "</th>";
    });
    html += "</tr>";

    if (showTech) {
      html += "<tr class=\"dmsRowTech\"><th class=\"dmsRowHead\">Technical name</th>";
      fields.forEach((f) => {
        html += "<th>" + escapeHtml(f.technicalName || "") + "</th>";
      });
      html += "</tr>";
    }

    if (showType) {
      html += "<tr class=\"dmsRowType\"><th class=\"dmsRowHead\">Type / length</th>";
      fields.forEach((f) => {
        const type = [f.dataType, f.length, f.decimals ? "dec " + f.decimals : ""]
          .filter(Boolean)
          .join(" ");
        html += "<th>" + escapeHtml(type) + "</th>";
      });
      html += "</tr>";
    }

    html += "</thead><tbody>";
    if (!rows.length) {
      html += "<tr class=\"dmsEmptyRow\"><td class=\"dmsRowHead\"></td><td colspan=\"" +
        Math.max(fields.length, 1) + "\">No data rows in this tab. Field definitions are shown in the header.</td></tr>";
    }
    rows.forEach((row, idx) => {
      let values = [];
      try {
        values = JSON.parse(row.values || "[]");
      } catch (e) {
        values = [];
      }
      html += "<tr><th class=\"dmsRowHead\">" + (idx + 1) + "</th>";
      fields.forEach((f) => {
        const value = values[f.columnIndex] == null ? "" : String(values[f.columnIndex]);
        const cls = f.mandatory ? " class=\"dmsMandatoryCell\"" : "";
        html += "<td" + cls + ">" + escapeHtml(value) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }

  function columnLetter(index) {
    let n = index;
    let letter = "";
    do {
      letter = String.fromCharCode((n % 26) + 65) + letter;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letter;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
});
