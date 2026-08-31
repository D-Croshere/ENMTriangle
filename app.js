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

const CENTER_RADIUS = 35; // px, distance from centroid for the "adventurer" zone
const VERTEX_RADIUS = 66; // px, distance from a vertex for a "pure" zone

// Edge-midpoint zones: one normalized weight near zero, the other two close
// to each other. Tolerance is a fraction of the 0-1 weight range.
const EDGE_TOLERANCE = 0.05;

// Below this per-axis total (after clamping negatives to zero) on all three
// axes, no dot is plotted — the "monogamous" result is shown instead.
const MONOGAMOUS_THRESHOLD = 1;

// Canonical home of The ENM Triangle — share links always point here.
const SHARE_BASE = "https://enmtriangle.netlify.app/";

// localStorage key for in-progress quiz answers.
const STORAGE_KEY = "enm-triangle-progress";

// Likert scale shown for every question (stored/scored as 1-5).
const LIKERT = [
  { value: 1, label: "Strongly disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Neutral" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly agree" },
];

// Quiz questions live in questions.json (editable without touching code).
let QUESTION_LIST = [];
let QUESTION_BY_ID = {};

// Result copy lives in zones.json (editable without touching code).
let ZONES = {};

// Current quiz state (also mirrored to localStorage).
let quiz = { order: [], responses: {}, index: 0 };

// The totals behind whatever is currently shown on screen 2.
let plotted = null;

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadZones() {
  try {
    ZONES = (await loadJson("zones.json")).zones || {};
  } catch (err) {
    console.warn("Could not load zones.json:", err);
    ZONES = {};
  }
}

async function loadQuestions() {
  try {
    QUESTION_LIST = (await loadJson("questions.json")).questions || [];
  } catch (err) {
    console.warn("Could not load questions.json:", err);
    QUESTION_LIST = [];
  }
  QUESTION_BY_ID = Object.fromEntries(QUESTION_LIST.map((q) => [q.id, q]));
}

function zoneCopy(key) {
  return ZONES[key] || { title: "Your spot on the triangle", description: "", shareLine: "" };
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

const els = {
  screenQ:      document.getElementById("screen-questions"),
  screenC:      document.getElementById("screen-computing"),
  screenR:      document.getElementById("screen-results"),
  computingMask: document.getElementById("computing-mask"),
  resumePrompt: document.getElementById("resume-prompt"),
  resumeSub:    document.getElementById("resume-sub"),
  resumeYes:    document.getElementById("resume-yes"),
  resumeNo:     document.getElementById("resume-no"),
  form:         document.getElementById("quiz-form"),
  progress:     document.getElementById("progress"),
  progressFill: document.getElementById("progress-fill"),
  questionText: document.getElementById("question-text"),
  likert:       document.getElementById("likert"),
  validation:   document.getElementById("validation"),
  back:         document.getElementById("back"),
  next:         document.getElementById("next"),
  announce:     document.getElementById("quiz-announce"),
  canvas:       document.getElementById("triangle"),
  zoneTitle:    document.getElementById("zone-title"),
  zoneDesc:     document.getElementById("zone-desc"),
  share:        document.getElementById("share"),
  shareStatus:  document.getElementById("share-status"),
  startOver:    document.getElementById("start-over"),
};

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      order: quiz.order,
      responses: quiz.responses,
      index: quiz.index,
    }));
  } catch (err) {
    /* private mode / quota — progress just won't persist */
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    /* nothing to do */
  }
}

// Returns a valid saved session (matching the current question set) or null.
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.order) || typeof data.responses !== "object") return null;

    const ids = new Set(QUESTION_LIST.map((q) => q.id));
    if (data.order.length !== QUESTION_LIST.length) return null;
    if (!data.order.every((id) => ids.has(id))) return null;

    return {
      order: data.order,
      responses: data.responses || {},
      index: Math.min(Math.max(0, data.index | 0), data.order.length - 1),
    };
  } catch (err) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Screen 1: quiz
 * ------------------------------------------------------------------ */

// Fisher-Yates shuffle, once per session.
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startFresh() {
  quiz = {
    order: shuffled(QUESTION_LIST.map((q) => q.id)),
    responses: {},
    index: 0,
  };
  clearProgress();
}

function currentQuestion() {
  return QUESTION_BY_ID[quiz.order[quiz.index]];
}

function answeredCount() {
  return quiz.order.filter((id) => quiz.responses[id] != null).length;
}

function renderQuestion() {
  const q = currentQuestion();
  const total = quiz.order.length;
  const current = quiz.responses[q.id];

  els.progress.textContent = `Question ${quiz.index + 1} of ${total}`;
  els.progressFill.style.width = `${((quiz.index + 1) / total) * 100}%`;
  els.questionText.textContent = q.text;
  els.validation.textContent = "";

  els.likert.innerHTML = "";
  for (const opt of LIKERT) {
    const id = `likert-${opt.value}`;
    const label = document.createElement("label");
    label.className = "likert-option";
    label.innerHTML = `
      <input type="radio" name="likert" value="${opt.value}" id="${id}"
             ${current === opt.value ? "checked" : ""}>
      <span>${opt.label}</span>
    `;
    els.likert.appendChild(label);
  }

  els.likert.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      quiz.responses[q.id] = Number(input.value);
      els.validation.textContent = "";
      saveProgress();
    });
  });

  els.back.disabled = quiz.index === 0;
  els.next.disabled = false;
  els.next.textContent = quiz.index === total - 1 ? "See My Results" : "Next";
}

function showQuiz() {
  els.resumePrompt.hidden = true;
  els.form.hidden = false;
  els.screenC.hidden = true;
  els.screenR.hidden = true;
  els.screenQ.hidden = false;
  renderQuestion();
}

function showResumePrompt(saved) {
  els.form.hidden = true;
  els.resumePrompt.hidden = false;
  const done = Object.keys(saved.responses).length;
  els.resumeSub.textContent =
    `You'd left off at question ${saved.index + 1} of ${saved.order.length} (${done} answered).`;

  els.resumeYes.onclick = () => {
    quiz = saved;
    showQuiz();
  };
  els.resumeNo.onclick = () => {
    startFresh();
    showQuiz();
  };
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = currentQuestion();

  // Advancing requires an answer — an unanswered question has no defined
  // score contribution.
  if (quiz.responses[q.id] == null) {
    els.validation.textContent = "Please choose an answer to continue.";
    return;
  }

  if (quiz.index < quiz.order.length - 1) {
    quiz.index++;
    saveProgress();
    renderQuestion();
  } else {
    finishQuiz();
  }
});

els.back.addEventListener("click", () => {
  if (quiz.index === 0) return;
  quiz.index--;
  saveProgress();
  renderQuestion();
});

// Length of the non-interactive "computing" pause between the last question
// and the results. A deliberate beat for feel — the math itself is instant.
const COMPUTING_MS = 600;

function finishQuiz() {
  // Guard against a stray second click/Enter landing before the screen swaps.
  els.next.disabled = true;
  els.back.disabled = true;

  const totals = scoreQuiz(QUESTION_LIST, quiz.responses);
  clearProgress();

  showComputing();
  animateComputingBar(COMPUTING_MS);
  setTimeout(() => showResults(totals), COMPUTING_MS);
}

function showComputing() {
  els.screenQ.hidden = true;
  els.screenR.hidden = true;
  els.screenC.hidden = false;
}

// Fill 0% -> 100% over `duration` ms by shrinking the mask that covers the
// fixed gradient bar.
function animateComputingBar(duration) {
  const start = performance.now();
  els.computingMask.style.width = "100%";

  function frame(now) {
    const p = Math.min(1, (now - start) / duration);
    els.computingMask.style.width = `${(1 - p) * 100}%`;
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

// responses: { q01: 4, q02: 2, ... } — Likert value (1-5) per question id.
//
// Each response maps to a signed multiplier on the question's weights:
//   1 strongly disagree -> -1     3 neutral -> 0     5 strongly agree -> +1
//   2 disagree          -> -0.5                      4 agree          -> +0.5
// i.e. (response - 3) / 2. `reverse: true` flips the sign, so agreement
// pulls the loaded axis down. Axis totals can therefore be negative.
function scoreQuiz(questions, responses) {
  const totals = { poly: 0, swinger: 0, kinky: 0 };

  for (const q of questions) {
    let value = (responses[q.id] - 3) / 2;
    if (q.reverse) value = -value;
    totals.poly    += q.weights.poly    * value;
    totals.swinger += q.weights.swinger * value;
    totals.kinky   += q.weights.kinky   * value;
  }

  return totals;
}

function getResult(totals) {
  // A negative axis total means "actively not this" — for plotting that's the
  // same as zero. Clamp before the monogamous check and normalisation.
  const poly    = Math.max(0, totals.poly);
  const swinger = Math.max(0, totals.swinger);
  const kinky   = Math.max(0, totals.kinky);

  if (poly    < MONOGAMOUS_THRESHOLD &&
      swinger < MONOGAMOUS_THRESHOLD &&
      kinky   < MONOGAMOUS_THRESHOLD) {
    return { type: "monogamous" };
  }

  const sum = poly + swinger + kinky;
  const wPoly    = sum === 0 ? 1 / 3 : poly    / sum;
  const wSwinger = sum === 0 ? 1 / 3 : swinger / sum;
  const wKinky   = sum === 0 ? 1 / 3 : kinky   / sum;

  const x = wKinky * KINKY.x + wPoly * POLY.x + wSwinger * SWINGER.x;
  const y = wKinky * KINKY.y + wPoly * POLY.y + wSwinger * SWINGER.y;

  return {
    type: "zone",
    zoneKey: getZone(x, y, wPoly, wSwinger, wKinky),
    x, y, wPoly, wSwinger, wKinky,
  };
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
  if (dist({ x, y }, CENTROID) <= CENTER_RADIUS) return "adventurer";

  if (dist({ x, y }, KINKY)   <= VERTEX_RADIUS) return "pure_kinky";
  if (dist({ x, y }, POLY)    <= VERTEX_RADIUS) return "pure_poly";
  if (dist({ x, y }, SWINGER) <= VERTEX_RADIUS) return "pure_swinger";

  // Edge-midpoint zones: one axis near zero, the other two close to each
  // other. Tolerance band on the normalized weights (was an exact tie on
  // raw slider values, unreachable once scores come from 30+ Likert items).
  if (wSwinger <= EDGE_TOLERANCE && Math.abs(wKinky - wPoly) <= EDGE_TOLERANCE) {
    return "edge_kinky_poly";
  }
  if (wKinky <= EDGE_TOLERANCE && Math.abs(wPoly - wSwinger) <= EDGE_TOLERANCE) {
    return "edge_poly_swinger";
  }
  if (wPoly <= EDGE_TOLERANCE && Math.abs(wKinky - wSwinger) <= EDGE_TOLERANCE) {
    return "edge_kinky_swinger";
  }

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

function showResults(totals) {
  paintGradient();

  const result = getResult(totals);
  let copy;

  if (result.type === "monogamous") {
    // Still show the triangle for visual consistency, but plot no dot.
    copy = zoneCopy("monogamous");
    els.canvas.setAttribute("aria-label", "Triangle chart — no result plotted");
  } else {
    const ctx = els.canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(result.x, result.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#0f1115";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    copy = zoneCopy(result.zoneKey);
    els.canvas.setAttribute("aria-label", "Triangle chart with your result plotted as a dot");
  }

  els.zoneTitle.textContent = copy.title;
  els.zoneDesc.textContent = copy.description;

  plotted = { totals, zone: copy, monogamous: result.type === "monogamous" };
  els.shareStatus.textContent = "";

  els.screenQ.hidden = true;
  els.screenC.hidden = true;
  els.screenR.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Share link
 * ------------------------------------------------------------------ */

function shareUrl({ totals }) {
  const u = new URL(SHARE_BASE);
  u.search = new URLSearchParams({
    poly:    totals.poly.toFixed(2),
    swinger: totals.swinger.toFixed(2),
    kinky:   totals.kinky.toFixed(2),
  }).toString();
  return u.toString();
}

function shareText() {
  const { zone } = plotted;
  return `I'm "${zone.title}" on The ENM Triangle\n${zone.shareLine}\n${shareUrl(plotted)}`;
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

// If the page is opened with ?poly=&swinger=&kinky= (raw axis totals), jump
// straight to the result those totals produce.
function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  if (!p.has("poly") && !p.has("swinger") && !p.has("kinky")) return false;

  const num = (v) => Math.max(0, Number(v) || 0);
  showResults({
    poly:    num(p.get("poly")),
    swinger: num(p.get("swinger")),
    kinky:   num(p.get("kinky")),
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

els.share.addEventListener("click", copyShareLink);

els.startOver.addEventListener("click", () => {
  history.replaceState(null, "", location.pathname); // drop any ?poly=... params
  clearProgress();
  startFresh();
  showQuiz();
  els.announce.textContent = "";
});

(async function init() {
  await Promise.all([loadZones(), loadQuestions()]);

  if (loadFromUrl()) return;

  const saved = loadProgress();
  if (saved && Object.keys(saved.responses).length > 0) {
    showResumePrompt(saved);
  } else {
    startFresh();
    showQuiz();
  }
})();
