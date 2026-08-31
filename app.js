"use strict";

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

// Logical drawing space (matches the <canvas> width/height attributes).
const VIEW_W = 300;
const VIEW_H = 280;

// Fixed equilateral-ish vertices in logical space.
const KINKY   = { x: 150, y: 22 };
const POLY    = { x: 26,  y: 246 };
const SWINGER = { x: 274, y: 246 };

const CENTROID = {
  x: (KINKY.x + POLY.x + SWINGER.x) / 3,
  y: (KINKY.y + POLY.y + SWINGER.y) / 3,
};

// Corner colors (RGB triples).
const COLOR_KINKY   = [220, 38, 38];   // red
const COLOR_POLY    = [37, 99, 235];   // blue
const COLOR_SWINGER = [22, 163, 74];   // green

const CENTER_RADIUS = 52; // px, distance from centroid for the "adventurer" zone
const VERTEX_RADIUS = 66; // px, distance from a vertex for a "pure" zone

// Exact midpoints of each edge — a 50/50 split of two traits with the third
// at zero. EDGE_EPSILON is tight enough that only that single point matches.
const midpoint = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
const MID_KINKY_POLY    = midpoint(KINKY, POLY);
const MID_POLY_SWINGER  = midpoint(POLY, SWINGER);
const MID_KINKY_SWINGER = midpoint(KINKY, SWINGER);
const EDGE_EPSILON = 0.5; // px

// Canonical home of The ENM Triangle — share links always point here.
const SHARE_BASE = "https://enmtriangle.netlify.app/";

// `label` is the 1-2 word slider label; `trait` completes the shared
// "How much do you consider yourself ___?" prompt for screen readers.
const QUESTIONS = [
  { key: "poly",    label: "polyamorous", trait: "polyamorous" },
  { key: "swinger", label: "a swinger",   trait: "a swinger" },
  { key: "kinky",   label: "a kinkster",  trait: "a kinkster" },
];

// Current slider values, remembered across "Start Over". Default 0.
const answers = { poly: 0, swinger: 0, kinky: 0 };

// Result copy lives in zones.json (editable without touching code); loaded on init.
let ZONES = {};

async function loadZones() {
  try {
    const res = await fetch("zones.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ZONES = (await res.json()).zones || {};
  } catch (err) {
    console.warn("Could not load zones.json:", err);
    ZONES = {};
  }
}

function zoneCopy(key) {
  return ZONES[key] || { title: "Your spot on the triangle", description: "", shareLine: "" };
}

/* ------------------------------------------------------------------ *
 * Screen 1: questions
 * ------------------------------------------------------------------ */

const els = {
  screenQ:      document.getElementById("screen-questions"),
  screenR:      document.getElementById("screen-results"),
  form:         document.getElementById("quiz-form"),
  questions:    document.getElementById("questions"),
  announce:     document.getElementById("slider-announce"),
  canvas:       document.getElementById("triangle"),
  zoneTitle:    document.getElementById("zone-title"),
  zoneDesc:     document.getElementById("zone-desc"),
  share:        document.getElementById("share"),
  shareStatus:  document.getElementById("share-status"),
  startOver:    document.getElementById("start-over"),
};

// The values behind whatever is currently plotted on screen 2.
let plotted = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderQuestions() {
  els.questions.innerHTML = "";
  for (const q of shuffle(QUESTIONS)) {
    const wrap = document.createElement("div");
    wrap.className = "question";

    const id = `slider-${q.key}`;
    const current = answers[q.key];
    wrap.innerHTML = `
      <label class="question-label" for="${id}">
        <span>${q.label}</span>
        <span class="question-value" id="${id}-value">${current}</span>
      </label>
      <input type="range" id="${id}" name="${q.key}" min="0" max="100" value="${current}"
             aria-label="How much do you consider yourself ${q.trait}?"
             aria-describedby="${id}-value">
    `;
    els.questions.appendChild(wrap);

    const input = wrap.querySelector("input");
    const value = wrap.querySelector(".question-value");
    input.addEventListener("input", () => {
      answers[q.key] = Number(input.value);
      value.textContent = input.value;
      els.announce.textContent = `${q.label}: ${input.value}`;
    });
  }
}

/* ------------------------------------------------------------------ *
 * Barycentric math
 * ------------------------------------------------------------------ */

function pointToBarycentric(px, py, A, B, C) {
  const denom = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
  const wA = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / denom;
  const wB = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / denom;
  const wC = 1 - wA - wB;
  return { wA, wB, wC };
}

function drawGradientTriangle(ctx, A, B, C, colorA, colorB, colorC) {
  const minX = Math.floor(Math.min(A.x, B.x, C.x));
  const maxX = Math.ceil(Math.max(A.x, B.x, C.x));
  const minY = Math.floor(Math.min(A.y, B.y, C.y));
  const maxY = Math.ceil(Math.max(A.y, B.y, C.y));

  const w = maxX - minX;
  const h = maxY - minY;
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const { wA, wB, wC } = pointToBarycentric(x + 0.5, y + 0.5, A, B, C);
      const i = ((y - minY) * w + (x - minX)) * 4;
      if (wA >= 0 && wB >= 0 && wC >= 0) {
        data[i]     = wA * colorA[0] + wB * colorB[0] + wC * colorC[0];
        data[i + 1] = wA * colorA[1] + wB * colorB[1] + wC * colorC[1];
        data[i + 2] = wA * colorA[2] + wB * colorB[2] + wC * colorC[2];
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(imageData, minX, minY);
}

function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function getZone(x, y, wPoly, wSwinger, wKinky) {
  // Exact edge-midpoint zones — checked first; each matches one point only.
  if (dist({ x, y }, MID_KINKY_POLY)    <= EDGE_EPSILON) return "edge_kinky_poly";
  if (dist({ x, y }, MID_POLY_SWINGER)  <= EDGE_EPSILON) return "edge_poly_swinger";
  if (dist({ x, y }, MID_KINKY_SWINGER) <= EDGE_EPSILON) return "edge_kinky_swinger";

  if (dist({ x, y }, CENTROID) <= CENTER_RADIUS) return "adventurer";

  if (dist({ x, y }, KINKY)   <= VERTEX_RADIUS) return "pure_kinky";
  if (dist({ x, y }, POLY)    <= VERTEX_RADIUS) return "pure_poly";
  if (dist({ x, y }, SWINGER) <= VERTEX_RADIUS) return "pure_swinger";

  const max = Math.max(wPoly, wSwinger, wKinky);
  if (max === wKinky) {
    return wPoly > wSwinger ? "kinky_leaning_poly" : "kinky_leaning_swinger";
  } else if (max === wPoly) {
    return wKinky > wSwinger ? "poly_leaning_kinky" : "poly_leaning_swinger";
  } else {
    return wKinky > wPoly ? "swinger_leaning_kinky" : "swinger_leaning_poly";
  }
}

/* ------------------------------------------------------------------ *
 * Screen 2: results
 * ------------------------------------------------------------------ */

function paintGradient() {
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawGradientTriangle(ctx, KINKY, POLY, SWINGER, COLOR_KINKY, COLOR_POLY, COLOR_SWINGER);
}

function showResults(poly, swinger, kinky) {
  const sum = poly + swinger + kinky;
  const wPoly    = sum === 0 ? 1 / 3 : poly    / sum;
  const wSwinger = sum === 0 ? 1 / 3 : swinger / sum;
  const wKinky   = sum === 0 ? 1 / 3 : kinky   / sum;

  const x = wKinky * KINKY.x + wPoly * POLY.x + wSwinger * SWINGER.x;
  const y = wKinky * KINKY.y + wPoly * POLY.y + wSwinger * SWINGER.y;

  paintGradient();

  const ctx = els.canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#0f1115";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  const zone = zoneCopy(getZone(x, y, wPoly, wSwinger, wKinky));
  els.zoneTitle.textContent = zone.title;
  els.zoneDesc.textContent = zone.description;

  plotted = { poly, swinger, kinky, zone };
  els.shareStatus.textContent = "";

  els.screenQ.hidden = true;
  els.screenR.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Share link
 * ------------------------------------------------------------------ */

function shareUrl({ poly, swinger, kinky }) {
  const u = new URL(SHARE_BASE);
  u.search = new URLSearchParams({ poly, swinger, kinky }).toString();
  return u.toString();
}

function shareText() {
  const { zone } = plotted;
  return `I'm "${zone.title}" on The ENM Triangle — ${zone.shareLine}\n${shareUrl(plotted)}`;
}

async function copyShareLink() {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    els.shareStatus.textContent = "Copied to clipboard.";
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    els.shareStatus.textContent = ok
      ? "Copied to clipboard."
      : "Couldn't copy — here's the link: " + shareUrl(plotted);
  }
}

// If the page is opened with ?poly=&swinger=&kinky=, jump straight to the
// result with that exact point plotted.
function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  if (!p.has("poly") && !p.has("swinger") && !p.has("kinky")) return false;

  const clamp = (v) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
  answers.poly    = clamp(p.get("poly"));
  answers.swinger = clamp(p.get("swinger"));
  answers.kinky   = clamp(p.get("kinky"));
  showResults(answers.poly, answers.swinger, answers.kinky);
  return true;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  showResults(answers.poly, answers.swinger, answers.kinky);
});

els.share.addEventListener("click", copyShareLink);

els.startOver.addEventListener("click", () => {
  history.replaceState(null, "", location.pathname); // drop any ?poly=... params
  els.screenR.hidden = true;
  els.screenQ.hidden = false;
  renderQuestions(); // reshuffles order, keeps the values already entered
  els.announce.textContent = "";
});

(async function init() {
  await loadZones();
  renderQuestions();
  loadFromUrl();
})();
