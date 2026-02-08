const keytar = require("keytar");

(async () => {
  const key = await keytar.getPassword("JobAppID-Kiosk", "kiosk_api_key");
  console.log("KIOSK_API_KEY =", key || "(none found)");
})();
