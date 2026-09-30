sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("datavapte.migration.studio.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      const appModel = new JSONModel({
        busy: false,
        busyReason: "",
        templates: [],
        blankTemplates: [],
        selectedBlankId: "",
        selectedBlank: null,
        current: null,
        valueHelps: {},
        editor: {
          sheetId: "",
          title: "",
          isMandatory: false,
          introVisible: false,
          tableVisible: true,
          introText: "",
          fields: [],
          rows: [],
          dirty: false
        },
        table: {
          headerHeight: 44,
          rowHeight: 28
        }
      });
      appModel.setSizeLimit(20000);
      this.setModel(appModel, "app");

      this.getRouter().initialize();
    }
  });
});
