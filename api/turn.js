// Relay ("TURN") servers for calls. Most calls connect phone-to-phone, but mobile data and some Wi-Fi block that,
// so the video has to go through a relay. By default this uses the free Open Relay project (metered.ca/tools/openrelay,
// 20 GB a month, no sign-up): logins are made with its public shared secret and expire after 12 hours.
// Optional, later: set METERED_TURN_URL (e.g. https://yourapp.metered.live/api/v1/turn/credentials?apiKey=...) in Vercel
// to use your own free Metered account instead.
const crypto = require("crypto");

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const OPEN_RELAY_HOST = "staticauth.openrelay.metered.ca";
const OPEN_RELAY_SECRET = "openrelayprojectsecret"; // public secret published by the Open Relay project

function openRelay() {
  const username = Math.floor(Date.now() / 1000 + 12 * 3600) + ":funi";
  const credential = crypto.createHmac("sha1", OPEN_RELAY_SECRET).update(username).digest("base64");
  return [{
    urls: [
      "turn:" + OPEN_RELAY_HOST + ":80",
      "turn:" + OPEN_RELAY_HOST + ":80?transport=tcp",
      "turn:" + OPEN_RELAY_HOST + ":443",
      "turns:" + OPEN_RELAY_HOST + ":443?transport=tcp"
    ],
    username, credential
  }];
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let relay = [];
  const own = process.env.METERED_TURN_URL;
  if (own) {
    try { const r = await fetch(own); if (r.ok) relay = await r.json(); } catch (e) { console.error("turn", e.message); }
  }
  if (!Array.isArray(relay) || !relay.length) relay = openRelay();
  res.status(200).json({ iceServers: STUN.concat(relay) });
};
module.exports.openRelay = openRelay;
