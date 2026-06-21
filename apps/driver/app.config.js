const fs = require("node:fs");
const path = require("node:path");
const app = require("./app.json");

module.exports = () => {
  const googleServicesFile = "./google-services.json";
  const hasFirebaseConfig = fs.existsSync(path.join(__dirname, "google-services.json"));

  return {
    ...app.expo,
    android: {
      ...app.expo.android,
      ...(hasFirebaseConfig ? { googleServicesFile } : {})
    },
    extra: {
      ...app.expo.extra,
      firebaseConfigured: hasFirebaseConfig
    }
  };
};
