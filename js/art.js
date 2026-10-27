/* Funi cartoon art: avatars, feeling faces and little study scenes, all drawn as SVG.
 * Avatar "look" = { skin: 0-5, hair: style, hairColor: 0-4, hoodie: 0-5 } */
(function () {
  "use strict";

  const SKIN = ["#F7D6B8", "#EBB894", "#CF9168", "#AA6C46", "#7F4C2F", "#5B341F"];
  const SKIN_SHADE = ["#EDBF9C", "#DCA27C", "#BA7C55", "#94593A", "#6C3E25", "#4A2A18"];
  const HAIR_COLORS = ["#2A1A16", "#4A2C20", "#1F1B2A", "#7A4A2C", "#B47A4A"];
  const HOODIES = ["#8F75E8", "#F29B7E", "#5DBB9C", "#EDB84F", "#E57FAE", "#5D74D6"];
  const HOODIE_DARK = ["#7258D0", "#DD7F62", "#479F82", "#D29C33", "#CC6393", "#4659BC"];
  const BG = ["#EDE6FF", "#FFE7DD", "#DDF3EA", "#FFF1D2", "#FFE2EE", "#E2E8FF"];
  const HAIR_STYLES = ["puffs", "afro", "bun", "long", "braids", "short", "curly"];
  const EXTRA_HAIR = ["beanie"]; // kept separate so everyone's automatic avatar stays the same
  const FEELINGS = ["Feeling great", "Happy", "Okay", "Confused", "Stressed", "Need help"];

  function hashOf(s) { let h = 7; for (const c of String(s || "funi")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

  function defaultLook(seed) {
    const h = hashOf(seed);
    return { skin: h % SKIN.length, hair: HAIR_STYLES[(h >>> 3) % HAIR_STYLES.length], hairColor: (h >>> 6) % 3, hoodie: (h >>> 9) % HOODIES.length };
  }
  function parseLook(raw, seed) {
    let look = null;
    if (raw && typeof raw === "object") look = raw;
    else if (raw) { try { look = JSON.parse(raw); } catch (e) { look = null; } }
    const d = defaultLook(seed);
    if (!look) return d;
    return {
      skin: Number.isInteger(look.skin) && SKIN[look.skin] ? look.skin : d.skin,
      hair: HAIR_STYLES.concat(EXTRA_HAIR).includes(look.hair) ? look.hair : d.hair,
      phones: look.phones === true,
      hairColor: Number.isInteger(look.hairColor) && HAIR_COLORS[look.hairColor] ? look.hairColor : d.hairColor,
      hoodie: Number.isInteger(look.hoodie) && HOODIES[look.hoodie] ? look.hoodie : d.hoodie
    };
  }

  /* ---------- hair, drawn behind and in front of the head ---------- */
  function hairBack(style, h) {
    switch (style) {
      case "puffs": return '<circle cx="31" cy="27" r="14" fill="' + h + '"/><circle cx="89" cy="27" r="14" fill="' + h + '"/>';
      case "afro": return '<circle cx="60" cy="46" r="36" fill="' + h + '"/>';
      case "bun": return '<circle cx="60" cy="17" r="12" fill="' + h + '"/>';
      case "long": return '<path d="M33 52Q29 18 60 18Q91 18 87 52L92 100Q80 104 74 90L46 90Q40 104 28 100Z" fill="' + h + '"/>';
      case "braids":
        return '<path d="M34 50Q31 20 60 20Q89 20 86 50L88 104H76L74 80H46L44 104H32Z" fill="' + h + '"/>' +
          '<path d="M37 60V100M43 62V102M77 62V102M83 60V100" stroke="#000" stroke-opacity=".18" stroke-width="2" stroke-linecap="round"/>';
      default: return "";
    }
  }
  function hairFront(style, h) {
    switch (style) {
      case "puffs":
      case "bun":
        return '<path d="M35 52Q32 23 60 23Q88 23 85 52Q80 37 60 36Q41 36 35 52Z" fill="' + h + '"/>';
      case "afro":
        return '<path d="M34 54Q30 22 60 22Q90 22 86 54Q80 38 60 37Q40 38 34 54Z" fill="' + h + '"/>';
      case "long":
        return '<path d="M35 54Q32 22 60 22Q88 22 85 54Q84 40 72 33Q58 44 38 42Q36 46 35 54Z" fill="' + h + '"/>';
      case "braids":
        return '<path d="M35 52Q32 23 60 23Q88 23 85 52Q80 37 60 36Q41 36 35 52Z" fill="' + h + '"/>' +
          '<path d="M37 41Q60 27 83 41" fill="none" stroke="#F3C25E" stroke-width="5" stroke-linecap="round"/>';
      case "short":
        return '<path d="M35 53Q33 25 60 24Q87 25 85 53Q83 40 74 36Q62 42 41 40Q37 45 35 53Z" fill="' + h + '"/>';
      case "beanie":
        return '<path d="M36 52Q38 44 46 43L50 50L54 43L60 49L66 43L71 50L75 43Q83 44 84 52Q80 47 74 47Q60 52 46 47Q40 47 36 52Z" fill="' + h + '"/>' +
          '<path d="M33 46Q31 15 60 14Q89 15 87 46Z" fill="#F4F2EE"/>' +
          '<path d="M31 47Q60 36 89 47L89 40Q60 30 31 40Z" fill="#E6E2DB"/>' +
          '<path d="M43 39V20M51 37V16M60 36V15M69 37V16M77 39V20" stroke="#D9D3C9" stroke-width="2.2" stroke-linecap="round"/>';
      case "curly":
        return '<g fill="' + h + '"><circle cx="40" cy="38" r="8"/><circle cx="50" cy="31" r="8.5"/><circle cx="61" cy="29" r="9"/><circle cx="72" cy="31" r="8.5"/><circle cx="81" cy="38" r="8"/><path d="M35 52Q33 34 45 32H75Q87 34 85 52Q80 42 60 41Q40 42 35 52Z"/></g>';
      default: return "";
    }
  }

  /* ---------- faces per feeling ---------- */
  function face(feeling) {
    const eye = (x) => '<ellipse cx="' + x + '" cy="57" rx="3.7" ry="4.5" fill="#2A1E2A"/><circle cx="' + (x + 1.3) + '" cy="55.3" r="1.4" fill="#fff"/>';
    let eyes = eye(50) + eye(70), brows = "", mouth = "", extra = "";
    const blush = '<ellipse cx="43" cy="65" rx="4.6" ry="2.8" fill="#F28C9B" opacity=".5"/><ellipse cx="77" cy="65" rx="4.6" ry="2.8" fill="#F28C9B" opacity=".5"/>';
    switch (feeling) {
      case "Feeling great":
        eyes = '<path d="M46 57Q50 52 54 57M66 57Q70 52 74 57" fill="none" stroke="#2A1E2A" stroke-width="2.6" stroke-linecap="round"/>';
        mouth = '<path d="M51 66Q60 77 69 66Z" fill="#7A2E3A"/><path d="M54 70Q60 74 66 70" fill="#F07C8C"/>';
        extra = '<path d="M90 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#F3C25E"/>';
        break;
      case "Happy":
        mouth = '<path d="M52 67Q60 74 68 67" fill="none" stroke="#7A2E3A" stroke-width="2.6" stroke-linecap="round"/>';
        break;
      case "Okay":
        mouth = '<path d="M54 69Q60 71.5 66 69" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/>';
        break;
      case "Confused":
        brows = '<path d="M45 49L54 47M66 46Q70 43 75 46" fill="none" stroke="#2A1E2A" stroke-width="2" stroke-linecap="round"/>';
        mouth = '<path d="M53 70Q56.5 67 60 70T67 69" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/>';
        extra = '<text x="86" y="40" font-size="16" font-weight="800" fill="#8F75E8" font-family="sans-serif">?</text>';
        break;
      case "Stressed":
        brows = '<path d="M45 48L54 51M75 48L66 51" fill="none" stroke="#2A1E2A" stroke-width="2" stroke-linecap="round"/>';
        mouth = '<path d="M53 72Q60 66 67 72" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/>';
        extra = '<path d="M84 40Q88 46 84 50Q80 46 84 40Z" fill="#8CC8F0"/>';
        break;
      case "Need help":
        brows = '<path d="M45 50L54 47M75 50L66 47" fill="none" stroke="#2A1E2A" stroke-width="2" stroke-linecap="round"/>';
        mouth = '<path d="M54 71Q60 67 66 71" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/>';
        extra = '<path d="M46 62Q48 67 46 70Q44 67 46 62Z" fill="#8CC8F0"/>';
        break;
      default:
        mouth = '<path d="M52 67Q60 74 68 67" fill="none" stroke="#7A2E3A" stroke-width="2.6" stroke-linecap="round"/>';
    }
    return brows + eyes + blush + '<path d="M58.5 62Q60 63.5 61.5 62" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1.6" stroke-linecap="round"/>' + mouth + extra;
  }

  /* ---------- hands under the chin (the "dreamy" pose) ---------- */
  function chinHands(hood, hoodD, skin, shade) {
    const arm = (d) => '<path d="' + d + '" fill="' + hood + '" stroke="' + hoodD + '" stroke-width="2.2" stroke-linejoin="round"/>';
    return arm("M16 124Q22 104 38 94L50 96Q44 108 42 124Z") + arm("M104 124Q98 104 82 94L70 96Q76 108 78 124Z") +
      '<rect x="36" y="90" width="17" height="8" rx="4" fill="' + hoodD + '"/><rect x="67" y="90" width="17" height="8" rx="4" fill="' + hoodD + '"/>' +
      '<ellipse cx="49" cy="87" rx="8.5" ry="6.2" fill="' + skin + '"/><ellipse cx="71" cy="87" rx="8.5" ry="6.2" fill="' + skin + '"/>' +
      '<path d="M45 84.5Q48 83 51 85M65 85Q68 83 71 84.5" fill="none" stroke="' + shade + '" stroke-width="1.5" stroke-linecap="round"/>';
  }

  /* ---------- the avatar bust ---------- */
  function avatarSVG(lookRaw, feeling, seed, opts) {
    const o = opts || {};
    const L = parseLook(lookRaw, seed);
    const skin = SKIN[L.skin], shade = SKIN_SHADE[L.skin], hair = HAIR_COLORS[L.hairColor];
    const hood = HOODIES[L.hoodie], hoodD = HOODIE_DARK[L.hoodie];
    const bg = o.noBg ? "" : '<circle cx="60" cy="60" r="60" fill="' + BG[L.hoodie] + '"/>';
    const clip = o.noBg ? "" : ' clip-path="url(#fc' + (seed ? hashOf(seed) : 0) + ')"';
    const tag = o.noBg ? '<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">' : '<svg viewBox="0 0 120 120" class="ava-svg" aria-hidden="true">';
    return tag +
      (o.noBg ? "" : '<defs><clipPath id="fc' + (seed ? hashOf(seed) : 0) + '"><circle cx="60" cy="60" r="60"/></clipPath></defs>') +
      bg + '<g' + clip + '>' +
      hairBack(L.hair, hair) +
      '<path d="M16 124C18 98 34 88 50 86L60 95L70 86C86 88 102 98 104 124Z" fill="' + hood + '"/>' +
      '<path d="M43 87Q60 104 77 87" fill="none" stroke="' + hoodD + '" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M54 98V110M66 98V110" stroke="#fff" stroke-opacity=".8" stroke-width="2.2" stroke-linecap="round"/>' +
      '<rect x="52" y="72" width="16" height="16" rx="6" fill="' + shade + '"/>' +
      '<circle cx="36" cy="58" r="5.5" fill="' + shade + '"/><circle cx="84" cy="58" r="5.5" fill="' + shade + '"/>' +
      '<ellipse cx="60" cy="55" rx="25" ry="27" fill="' + skin + '"/>' +
      hairFront(L.hair, hair) + face(feeling || "Happy") +
      (L.phones ? '<path d="M30 54Q29 14 60 13Q91 14 90 54" fill="none" stroke="#F7F7F9" stroke-width="5" stroke-linecap="round"/><path d="M30 54Q29 14 60 13Q91 14 90 54" fill="none" stroke="#D8DCE6" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>' +
        '<rect x="24" y="48" width="12" height="20" rx="6" fill="#FFFFFF" stroke="#D8DCE6" stroke-width="1.5"/><rect x="84" y="48" width="12" height="20" rx="6" fill="#FFFFFF" stroke="#D8DCE6" stroke-width="1.5"/>' : "") +
      (o.chin ? chinHands(hood, hoodD, skin, shade) : "") +
      "</g></svg>";
  }

  /* ---------- feeling face icons ---------- */
  const FACE_FILL = { "Feeling great": "#FFD45C", "Happy": "#FFD45C", "Okay": "#FFE18F", "Confused": "#CBB8FF", "Stressed": "#FFB3A7", "Need help": "#A9D3FF" };
  function feelingSVG(f) {
    const fill = FACE_FILL[f] || "#FFD45C";
    let inner = "";
    switch (f) {
      case "Feeling great":
        inner = '<rect x="12" y="19" width="10" height="7" rx="3" fill="#2A1E2A"/><rect x="26" y="19" width="10" height="7" rx="3" fill="#2A1E2A"/><path d="M22 21h4" stroke="#2A1E2A" stroke-width="2"/><path d="M16 31Q24 39 32 31Z" fill="#7A2E3A"/>';
        break;
      case "Happy":
        inner = '<path d="M15 22Q18 18 21 22M27 22Q30 18 33 22" fill="none" stroke="#2A1E2A" stroke-width="2.2" stroke-linecap="round"/><path d="M16 29Q24 37 32 29" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/><circle cx="13" cy="28" r="2.5" fill="#F28C9B" opacity=".6"/><circle cx="35" cy="28" r="2.5" fill="#F28C9B" opacity=".6"/>';
        break;
      case "Okay":
        inner = '<circle cx="18" cy="21" r="2.4" fill="#2A1E2A"/><circle cx="30" cy="21" r="2.4" fill="#2A1E2A"/><path d="M18 31H30" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/>';
        break;
      case "Confused":
        inner = '<circle cx="18" cy="22" r="2.4" fill="#2A1E2A"/><circle cx="30" cy="21" r="2.4" fill="#2A1E2A"/><path d="M14 16l7-1M27 14q3-2 6 0" stroke="#2A1E2A" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M17 32q3-3 6 0t7 0" fill="none" stroke="#7A2E3A" stroke-width="2.2" stroke-linecap="round"/>';
        break;
      case "Stressed":
        inner = '<path d="M13 17l7 3M35 17l-7 3" stroke="#2A1E2A" stroke-width="1.8" stroke-linecap="round"/><circle cx="18" cy="23" r="2.4" fill="#2A1E2A"/><circle cx="30" cy="23" r="2.4" fill="#2A1E2A"/><path d="M17 34Q24 28 31 34" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/><path d="M38 12q3 5 0 8q-3-3 0-8z" fill="#5FA8E0"/>';
        break;
      case "Need help":
        inner = '<path d="M14 19l6-2M34 19l-6-2" stroke="#2A1E2A" stroke-width="1.8" stroke-linecap="round"/><circle cx="18" cy="23" r="2.6" fill="#2A1E2A"/><circle cx="30" cy="23" r="2.6" fill="#2A1E2A"/><path d="M18 33Q24 29 30 33" fill="none" stroke="#7A2E3A" stroke-width="2.4" stroke-linecap="round"/><path d="M16 27q2 4 0 6q-2-2 0-6z" fill="#3F8FD2"/>';
        break;
    }
    return '<svg viewBox="0 0 48 48" class="face-svg" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="' + fill + '"/>' + inner + "</svg>";
  }

  /* ---------- scenes ---------- */
  function sparkle(x, y, s, c) {
    return '<path transform="translate(' + x + " " + y + ") scale(" + s + ')" d="M0-9C1-3 3-1 9 0C3 1 1 3 0 9C-1 3-3 1-9 0C-3-1-1-3 0-9Z" fill="' + c + '"/>';
  }
  // person at a laptop with a mug and a plant
  function studyScene(look, feeling, seed) {
    return '<svg viewBox="0 0 220 170" class="scene-svg" aria-hidden="true">' +
      '<ellipse cx="110" cy="96" rx="92" ry="70" fill="#FFFFFF" opacity=".35"/>' +
      sparkle(30, 34, 1, "#FFFFFF") + sparkle(190, 28, 0.8, "#FFE08A") + sparkle(196, 80, 0.55, "#FFFFFF") + sparkle(22, 92, 0.6, "#FFE08A") +
      '<path d="M176 40c-4-6-12-2-10 4 1 4 10 9 10 9s9-5 10-9c2-6-6-10-10-4z" fill="#F28CB0"/>' +
      '<g transform="translate(46 8) scale(1.08)">' + avatarSVG(look, feeling, seed, { noBg: true }) + "</g>" +
      '<rect x="0" y="146" width="220" height="24" rx="8" fill="#E7C9A6"/><rect x="0" y="146" width="220" height="6" fill="#D9B48C"/>' +
      '<path d="M78 108h64a6 6 0 0 1 6 6v32H72v-32a6 6 0 0 1 6-6z" fill="#D7D2E3"/><path d="M62 146h96l-6 6H68z" fill="#BDB6CF"/>' +
      '<path d="M106 124c-3-4-9-1-7 3 1 3 7 6 7 6s6-3 7-6c2-4-4-7-7-3z" fill="#FFFFFF"/>' +
      '<rect x="20" y="124" width="22" height="22" rx="6" fill="#F7A9B9"/><path d="M42 130c7 0 7 10 0 10" fill="none" stroke="#F7A9B9" stroke-width="4"/>' +
      '<path d="M27 133c1-2 4-2 4 0 0-2 3-2 4 0 0 2-4 5-4 5s-4-3-4-5z" fill="#FFFFFF"/>' +
      '<rect x="176" y="128" width="22" height="18" rx="5" fill="#B9A6F2"/>' +
      '<path d="M187 128c-10-6-12-18-4-20 2 8 4 12 4 20zM187 128c8-8 14-16 18-12-4 6-10 10-18 12zM187 128c-2-10 2-20 8-20 0 8-4 14-8 20z" fill="#6FBF8E"/>' +
      "</svg>";
  }
  // two friends side by side, for invites
  function friendsScene(lookA, lookB, seedA, seedB) {
    return '<svg viewBox="0 0 220 140" class="scene-svg" aria-hidden="true">' +
      sparkle(26, 30, 0.9, "#C9B8FF") + sparkle(196, 26, 0.8, "#C9B8FF") + sparkle(110, 18, 0.6, "#F7B7CF") +
      '<path d="M110 40c-5-7-14-2-12 5 1 5 12 11 12 11s11-6 12-11c2-7-7-12-12-5z" fill="#B49CF5"/>' +
      '<g transform="translate(14 24) scale(0.95)">' + avatarSVG(lookA, "Happy", seedA, { noBg: true }) + "</g>" +
      '<g transform="translate(92 24) scale(0.95)">' + avatarSVG(lookB, "Feeling great", seedB, { noBg: true }) + "</g>" +
      "</svg>";
  }

  function dreamyScene(look, feeling, seed) {
    return '<svg viewBox="0 0 200 180" class="scene-svg" aria-hidden="true">' +
      sparkle(26, 40, 1, "#B9A3F7") + sparkle(178, 30, 0.9, "#C9B8FF") + sparkle(184, 120, 0.6, "#B9A3F7") + sparkle(18, 128, 0.55, "#C9B8FF") +
      '<path d="M166 66c-4-6-12-2-10 4 1 4 10 9 10 9s9-5 10-9c2-6-6-10-10-4z" fill="#B49CF5"/>' +
      '<path d="M34 86c-3-4-9-1-7 3 1 3 7 6 7 6s6-3 7-6c2-4-4-7-7-3z" fill="#D8C9FF"/>' +
      '<g transform="translate(28 22) scale(1.2)">' + avatarSVG(look, feeling, seed, { noBg: true, chin: true }) + "</g></svg>";
  }

  // ready-made avatars for the profile picker
  const PRESETS = [
    { look: { skin: 4, hair: "puffs", hairColor: 0, hoodie: 0 }, kind: "Girls" }, { look: { skin: 2, hair: "afro", hairColor: 1, hoodie: 1 }, kind: "Girls" },
    { look: { skin: 1, hair: "bun", hairColor: 3, hoodie: 2 }, kind: "Girls" }, { look: { skin: 0, hair: "long", hairColor: 4, hoodie: 4 }, kind: "Girls" },
    { look: { skin: 5, hair: "braids", hairColor: 0, hoodie: 3 }, kind: "Girls" }, { look: { skin: 3, hair: "long", hairColor: 0, hoodie: 5 }, kind: "Girls" },
    { look: { skin: 1, hair: "beanie", hairColor: 3, hoodie: 5, phones: true }, kind: "Guys" }, { look: { skin: 4, hair: "beanie", hairColor: 0, hoodie: 5, phones: true }, kind: "Guys" },
    { look: { skin: 4, hair: "short", hairColor: 0, hoodie: 5 }, kind: "Guys" }, { look: { skin: 3, hair: "curly", hairColor: 0, hoodie: 2 }, kind: "Guys" },
    { look: { skin: 5, hair: "afro", hairColor: 0, hoodie: 3 }, kind: "Guys" }, { look: { skin: 1, hair: "short", hairColor: 3, hoodie: 1 }, kind: "Guys" },
    { look: { skin: 2, hair: "curly", hairColor: 1, hoodie: 0 }, kind: "Guys" }, { look: { skin: 0, hair: "short", hairColor: 4, hoodie: 4 }, kind: "Guys" }
  ];

  window.FuniArt = {
    PRESETS,
    SKIN, HAIR_COLORS, HOODIES, HAIR_STYLES, FEELINGS, BG,
    parseLook, defaultLook, avatarSVG, feelingSVG, studyScene, friendsScene, dreamyScene
  };
})();
