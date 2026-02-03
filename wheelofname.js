// ==UserScript==
// @name        Enhanced Wheel of Names - Free Stop + Exclusions + No Repeat
// @namespace   Violentmonkey Scripts
// @match       https://wheelofnames.com/*
// @grant       none
// @version     2.6
// @updateURL    https://raw.githubusercontent.com/SAD-DUST/share-file/refs/heads/main/wheelofname.js
// @downloadURL  https://raw.githubusercontent.com/SAD-DUST/share-file/refs/heads/main/wheelofname.js
// @author      Enhanced Version
// @description Exclusions + free-stop physics + clipped labels + slimmer text + more colors + slimmer pointer + prevent back-to-back wins + split modal buttons
// ==/UserScript==

(function () {
  // --- CONFIGURATION ---
  const COLORS = [
    { base: "#EEB211", gradient: ["#FFD700", "#C89200"] },
    { base: "#d50f25", gradient: ["#FF6B6B", "#B10B1B"] },
    { base: "#3369e8", gradient: ["#4D9DE0", "#1E4ED8"] },
    { base: "#009925", gradient: ["#00D9A5", "#007A1D"] },
    { base: "#6F42C1", gradient: ["#9B6DFF", "#4B2A9B"] },
    { base: "#0F766E", gradient: ["#2DD4BF", "#0B4F4A"] },
    { base: "#B45309", gradient: ["#FDBA74", "#7C2D12"] },
    { base: "#0B5ED7", gradient: ["#60A5FA", "#083B8A"] },
    { base: "#A21CAF", gradient: ["#F472B6", "#701A75"] },
    { base: "#1F2937", gradient: ["#6B7280", "#111827"] }
  ];

  const POINTER_ANGLE = 0;
  const EXCLUDE_KEYWORDS = ["thịnh", "thinh"];

  const NO_REPEAT_LAST_N = 1;

  const MIN_SPINS = 15;
  const MAX_SPINS = 25;
  const MIN_DURATION_MS = 7000;
  const MAX_DURATION_MS = 10000;

  const FONT_FAMILY = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"`;

  // --- HELPERS ---
  function waitForElement(selector) {
    return new Promise((resolve) => {
      if (document.querySelector(selector)) return resolve(document.querySelector(selector));
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          resolve(document.querySelector(selector));
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function normalizeAngle(a) {
    a %= 2 * Math.PI;
    if (a < 0) a += 2 * Math.PI;
    return a;
  }

  function normalizeText(s) {
    return (s || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function isExcludedByKeyword(name) {
    if (!name) return false;
    const n = normalizeText(name);
    return EXCLUDE_KEYWORDS.some((kw) => n.includes(normalizeText(kw)));
  }

  // --- STYLES ---
  const style = document.createElement("style");
  style.innerHTML = `
    .custom-wheel-container {
      position: relative;
      width: 100%;
      max-width: 700px;
      margin: 0 auto;
      aspect-ratio: 1 / 1;
      filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.3));
    }

    canvas#customWheelCanvas {
      width: 100%;
      height: 100%;
      cursor: pointer;
      display: block;
      transition: transform 0.1s ease;
    }

    canvas#customWheelCanvas:active { transform: scale(0.985); }

    .custom-pointer {
      position: absolute;
      right: -22px;
      top: 50%;
      transform: translateY(-50%);
      width: 42px;
      height: 56px;
      z-index: 100;
      filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.45));
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .custom-pointer::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 24px solid transparent;
      border-bottom: 24px solid transparent;
      border-right: 38px solid var(--pointer-color, #ffffff);
      transition: border-right-color 0.3s ease;
    }

    .custom-pointer::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 6px;
      height: 6px;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
    }

    @media (max-width: 900px) {
      .custom-pointer {
        right: 6px;
        width: 34px;
        height: 48px;
      }
      .custom-pointer::before {
        border-top: 20px solid transparent;
        border-bottom: 20px solid transparent;
        border-right: 30px solid var(--pointer-color, #ffffff);
      }
    }

    .winner-dialog {
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      transform: scale(0.95);
      animation: modalAppear 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    @keyframes modalAppear { to { transform: scale(1); } }

    .winner-text {
      background: linear-gradient(45deg, #FFD700, #FF6B6B);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 800;
      text-align: center;
    }

    /* Make our colored buttons look consistent with Quasar */
    .q-btn.enh-btn-red {
      background: #d50f25 !important;
      color: #fff !important;
    }
    .q-btn.enh-btn-blue {
      background: #60A5FA !important; /* light blue */
      color: #0b1b33 !important;
    }
  `;
  document.head.appendChild(style);

  // --- MODAL HTML (split into Remove + Spin Again) ---
  const modalHTML = `
  <div id="q-portal--dialog--4">
    <div role="dialog" aria-modal="true" class="q-dialog fullscreen no-pointer-events q-dialog--modal" style="display:none;">
      <div class="q-dialog__backdrop fixed-full" aria-hidden="true" tabindex="-1"></div>
      <div class="q-dialog__inner flex no-pointer-events q-dialog__inner--minimized q-dialog__inner--standard fixed-full flex-center" tabindex="-1">
        <div class="q-card q-card--dark q-dark winner-dialog">
          <div class="q-card__section q-card__section--vert flex gap justify-between text-h6" style="background: linear-gradient(135deg, #d50f25, #FF6B6B); color: white; padding: 20px;">
            🎉 We have a winner! 🎉
          </div>
          <div class="q-card__section q-card__section--vert" style="padding: 40px 250px;">
            <div class="flex gap items-center justify-center">
              <span class="winner-text text-h3">
                <span id="winnerNameDisplay">Winner</span>
              </span>
            </div>
          </div>
          <div class="q-card__actions justify-end q-card__actions--horiz row" style="padding: 15px; gap: 10px;">
            <button id="closeModalBtn" class="q-btn q-btn-item non-selectable no-outline q-btn--unelevated q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--no-uppercase" type="button">
              <span class="q-focus-helper"></span>
              <span class="q-btn__content text-center col items-center q-anchor--skip justify-center row"><span class="block">Close</span></span>
            </button>

            <button id="removeWinnerBtn" class="q-btn q-btn-item non-selectable no-outline q-btn--unelevated q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--no-uppercase enh-btn-red" type="button">
              <span class="q-focus-helper"></span>
              <span class="q-btn__content text-center col items-center q-anchor--skip justify-center row"><span class="block">Remove</span></span>
            </button>

            <button id="spinAgainBtn" class="q-btn q-btn-item non-selectable no-outline q-btn--unelevated q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--no-uppercase enh-btn-blue" type="button">
              <span class="q-focus-helper"></span>
              <span class="q-btn__content text-center col items-center q-anchor--skip justify-center row"><span class="block" style="color:white">Spin Again</span></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const existingPortal = document.getElementById("q-portal--dialog--4");
  if (existingPortal) existingPortal.remove();
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // --- GLOBAL STATE ---
  let entries = [];
  let arc = 0;
  let dpr = 1;
  let w = 0;
  let h = 0;
  let radius = 0;
  let currentAngle = 0;
  let isSpinning = false;

  let recentWinners = [];

  let ctx;
  let canvas;
  let container;
  let pointerElement;

  // --- INIT ---
  async function init() {
    try {
      const wheelContainer = await waitForElement(".wheel-container");
      wheelContainer.innerHTML = "";

      container = document.createElement("div");
      container.className = "custom-wheel-container";

      canvas = document.createElement("canvas");
      canvas.id = "customWheelCanvas";

      pointerElement = document.createElement("div");
      pointerElement.className = "custom-pointer";
      pointerElement.style.setProperty("--pointer-color", COLORS[0].base);

      container.appendChild(canvas);
      container.appendChild(pointerElement);
      wheelContainer.appendChild(container);

      ctx = canvas.getContext("2d");

      const editor = await waitForElement(".basic-editor");
      const observer = new MutationObserver(() => {
        if (!isSpinning) drawWheel();
      });
      observer.observe(editor, { subtree: true, characterData: true, childList: true });

      window.addEventListener("resize", resizeCanvas);
      canvas.addEventListener("click", spin);

      document.getElementById("closeModalBtn").addEventListener("click", closeModal);
      document.getElementById("removeWinnerBtn").addEventListener("click", removeWinnerOnly);
      document.getElementById("spinAgainBtn").addEventListener("click", spinAgain);
      document.querySelector("#q-portal--dialog--4 .q-dialog__backdrop").addEventListener("click", closeModal);

      resizeCanvas();
    } catch (error) {
      console.error("[WHEEL] Initialization failed:", error);
    }
  }

  init();

  function getEntries() {
    const editor = document.querySelector(".basic-editor");
    if (!editor) return ["Add", "Names", "To", "Begin"];
    return editor.innerText
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  function resizeCanvas() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = rect.width;
    h = rect.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    radius = Math.min(w, h) * 0.5 - 15;
    if (!isSpinning) drawWheel();
  }

  function indexAtPointer() {
    if (!entries.length) return 0;
    const a = normalizeAngle(POINTER_ANGLE - normalizeAngle(currentAngle));
    let idx = Math.floor(a / arc);
    return Math.max(0, Math.min(idx, entries.length - 1));
  }

  function updatePointerColor() {
    if (!pointerElement || !entries.length) return;
    const idx = indexAtPointer();
    const colorData = COLORS[idx % COLORS.length];
    pointerElement.style.setProperty("--pointer-color", colorData.base);
  }

  function drawWheel() {
    entries = getEntries();
    if (!entries.length) entries = ["Empty Wheel"];
    arc = (2 * Math.PI) / entries.length;
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(currentAngle);

    for (let i = 0; i < entries.length; i++) {
      const start = i * arc;
      const end = start + arc;
      const colorData = COLORS[i % COLORS.length];

      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, colorData.gradient[0]);
      gradient.addColorStop(1, colorData.gradient[1]);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fill();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.25, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255, 255, 255, 1)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fill();

    // Text
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 2;

    const fontSize = Math.max(12, radius * 0.075);
    ctx.font = `600 ${fontSize}px ${FONT_FAMILY}`;
    const textRadius = radius * 0.68;

    for (let i = 0; i < entries.length; i++) {
      const rawText = entries[i] ?? "";
      const mid = i * arc + arc / 2;

      ctx.save();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, i * arc, (i + 1) * arc);
      ctx.closePath();
      ctx.clip();

      ctx.rotate(mid);
      ctx.translate(textRadius, 0);

      const maxWidth = Math.max(10, (radius - textRadius) + (arc * radius * 0.55));
      let text = rawText;

      if (ctx.measureText(text).width > maxWidth) {
        const ell = "…";
        let lo = 0, hi = text.length;
        while (lo < hi) {
          const m = ((lo + hi) / 2) | 0;
          const candidate = text.slice(0, m) + ell;
          if (ctx.measureText(candidate).width <= maxWidth) lo = m + 1;
          else hi = m;
        }
        text = text.slice(0, Math.max(0, lo - 1)) + ell;
      }

      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    ctx.restore();
    updatePointerColor();
  }

  function customSpinEasing(t) {
    const deceleration = 1 - Math.pow(1 - t, 4);
    const microBounce = Math.sin(t * Math.PI * 8) * 0.005 * (1 - t);
    return Math.min(deceleration + microBounce, 1);
  }

  function isTemporarilyExcluded(name) {
    const n = normalizeText(name);
    if (isExcludedByKeyword(name)) return true;
    return recentWinners.includes(n);
  }

  function spin() {
    if (isSpinning) return;
    drawWheel();

    let candidates = entries
      .map((name, index) => ({ name, index }))
      .filter(item => !isTemporarilyExcluded(item.name))
      .map(item => item.index);

    if (candidates.length === 0) {
      const keywordOnly = entries
        .map((name, index) => ({ name, index }))
        .filter(item => !isExcludedByKeyword(item.name))
        .map(item => item.index);
      candidates = keywordOnly.length ? keywordOnly : entries.map((_, i) => i);
    }

    const winnerIdx = candidates[Math.floor(Math.random() * candidates.length)];
    const sliceCenter = winnerIdx * arc + arc / 2;

    const randomOffset = (Math.random() - 0.5) * (arc * 0.35);
    const targetAngleRaw = -(sliceCenter + randomOffset);

    const spins = Math.random() * (MAX_SPINS - MIN_SPINS) + MIN_SPINS;
    const duration = Math.random() * (MAX_DURATION_MS - MIN_DURATION_MS) + MIN_DURATION_MS;

    let finalAngle = targetAngleRaw;
    const minRotation = currentAngle + (spins * 2 * Math.PI);
    while (finalAngle < minRotation) finalAngle += 2 * Math.PI;

    const totalRotation = finalAngle - currentAngle;
    const startAngle = currentAngle;
    const t0 = performance.now();

    isSpinning = true;

    function frame(now) {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / duration);
      const eased = customSpinEasing(t);

      currentAngle = startAngle + totalRotation * eased;
      drawWheel();

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        currentAngle = finalAngle;
        drawWheel();
        isSpinning = false;

        const winnerName = entries[winnerIdx] ?? "Winner";
        const normWinner = normalizeText(winnerName);

        recentWinners.unshift(normWinner);
        recentWinners = recentWinners.slice(0, NO_REPEAT_LAST_N);

        showWinnerModal(winnerName);
      }
    }

    requestAnimationFrame(frame);
  }

  // --- MODAL FUNCTIONS ---
  function closeModal() {
    const modal = document.querySelector("#q-portal--dialog--4 .q-dialog");
    if (modal) modal.style.display = "none";
  }

  function removeWinnerOnly() {
    const winnerTextDisplay = document.getElementById("winnerNameDisplay");
    const winnerName = winnerTextDisplay ? winnerTextDisplay.textContent : "";
    if (!winnerName) return;

    const editor = document.querySelector(".basic-editor");
    if (!editor) return;

    const lines = editor.innerText.split("\n");
    editor.innerText = lines.filter(line => line.trim() !== winnerName).join("\n");
    drawWheel();
  }

  function spinAgain() {
    closeModal();
    // small delay so modal close feels smooth
    setTimeout(() => spin(), 120);
  }

  function showWinnerModal(name) {
    const modal = document.querySelector("#q-portal--dialog--4 .q-dialog");
    const winnerText = document.getElementById("winnerNameDisplay");
    if (winnerText) winnerText.textContent = name ?? "Winner";
    if (modal) modal.style.display = "block";
  }

})();
