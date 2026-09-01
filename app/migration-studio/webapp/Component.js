sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/odata/v4/ODataModel"
], function (UIComponent, JSONModel, ODataModel) {
  "use strict";

  return UIComponent.extend("datavapte.migration.studio.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      this.setModel(new JSONModel({
        busy: false,
        busyReason: "",
        templates: [],
        current: null
      }), "app");

      this.setModel(new ODataModel({
        serviceUrl: this.getManifestEntry("/sap.app/dataSources/mainService/uri"),
        synchronizationMode: "None",
        autoExpandSelect: false,
        operationMode: "Server"
      }));

      this.getRouter().initialize();
    }
  });
});
