sap.ui.define([], function () {
  "use strict";

  const CAP_ORIGIN = "https://the-innovapte-company-dev-space-datavapte-migration-srv.cfapps.us10.hana.ondemand.com";

  function appBase() {
    const path = String(location.pathname || "/");
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]*$/, "/");
  }

  function isLaunchpad() {
    return /launchpad\.cfapps\./i.test(location.hostname);
  }

  function isStandaloneApprouter() {
    return /datavapte-migration\.cfapps\./i.test(location.hostname);
  }

  return {
    url: function (path) {
      const rel = String(path || "").replace(/^\//, "");
      if (isLaunchpad() && /^(odata|sample)\//.test(rel)) {
        return CAP_ORIGIN + "/" + rel;
      }
      if (isStandaloneApprouter() && /^odata\//.test(rel)) {
        return "/" + rel;
      }
      if (isLaunchpad() || isStandaloneApprouter()) {
        return appBase() + rel;
      }
      return "/" + rel;
    },
    sampleUrl: function () {
      if (isLaunchpad() || isStandaloneApprouter()) {
        return appBase() + "sample/Source_data_for_Bank.xml";
      }
      return "/sample/Source_data_for_Bank.xml";
    }
  };
});
