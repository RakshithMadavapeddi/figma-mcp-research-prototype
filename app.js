(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const root = document.getElementById("root");
  const screenStyles = document.getElementById("screenStyles") || (() => {
    const s = document.createElement("style");
    s.id = "screenStyles";
    document.head.appendChild(s);
    return s;
  })();

  const snackbarStyles = document.getElementById("snackbarStyles") || (() => {
    const s = document.createElement("style");
    s.id = "snackbarStyles";
    document.head.appendChild(s);
    return s;
  })();

  // -------------------------
  // Scenario system
  // -------------------------
  const SCENARIO_STORAGE_KEY = "scenarioId";

  const SCENARIOS = {
    0: {
      id: 0,
      title: "Open / No Constraints",
      desc: "Current behavior (default)."
    },
    1: {
      id: 1,
      title: "Returning Guest Check-In",
      desc: "Check-In a returning guest, cash payment.",
      enforce: {
        forceReturning: true,
        scanMode: "success",
        preferredPayment: "cash"
      },
      presets: {
        guest: {
          fullName: "Jordan Taylor",
          streetAddress: "123 Main St",
          city: "Chicago",
          state: "IL",
          zip: "60601",
          gender: "Male",
          age: "32",
          idType: "DL",
          idNumber: "A1234567890"
        }
      }
    },
    2: {
      id: 2,
      title: "Scanner Failure / Manual Entry",
      desc: "Scan fails, Mnaual entery, Save and Continue.",
      enforce: {
        forceNew: true,
        scanMode: "fail",
        clearGuestFormOnce: true
      }
    },
    3: {
      id: 3,
      title: "Card Trouble",
      desc: "Card declines, recover via retry or cash.",
      enforce: {
        preferredPayment: "card",
        declineFirstCardAttempt: true
      },
      presets: {
        card: {
          cardNumberDecline: "4242 4242 4242 4241",
          expiry: "12/30",
          cvv: "123",
          nameOnCard: "Jordan Taylor"
        }
      }
    },
    4: {
      id: 4,
      title: "High Occupancy",
      desc: "Disable ~65% room options in Stay Details.",
      enforce: {
        occupancyRatio: 0.65,
        occupancySeed: "high-occupancy-65"
      }
    }
  };

  function normalizeScenarioId(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const i = Math.trunc(n);
    return (i >= 0 && i <= 4) ? i : 0;
  }

  function getScenarioId() {
    return normalizeScenarioId(localStorage.getItem(SCENARIO_STORAGE_KEY));
  }

  function resetScenarioRunFlags() {
    sessionStorage.removeItem("scenario2_guestClearedOnce");
    sessionStorage.removeItem("scenario3_declinedOnce");
  }

  function setScenarioId(id) {
    const next = normalizeScenarioId(id);
    localStorage.setItem(SCENARIO_STORAGE_KEY, String(next));
    resetScenarioRunFlags();
    updateScenarioIndicatorOnDashboard();
  }

  function getScenario() {
    const id = getScenarioId();
    return SCENARIOS[id] || SCENARIOS[0];
  }

  // -------------------------
  // Screen files
  // -------------------------
  const SCREEN_FILES = {
    dashboard: "dashboard.html",
    guestRegistration: "refinedGuestRegistration.html",
    returningGuest: "returningGuest.html",
    newGuest: "newGuest.html",
    stayDetails: "stayDetails.html",
    bookingSummary: "bookingSummary.html",
    cashPayment: "cashPayment.html",
    cashPaymentSuccessful: "cashPaymentSuccessful.html",
    cardPayment: "cardPayment.html",
    tapToPay: "tapToPay.html",
    cardPaymentProcessing: "cardPaymentProcessing.html",
    cardPaymentDeclined: "cardPaymentDeclined.html",
    cardPaymentSuccessful: "cardPaymentSuccessful.html",
    receiptPrinted: "receiptPrinted.html"
  };

  const SNACKBAR_FILES = {
    autofillSuccess: "autoFillSuccess.html",
    autofillFailed: "failedToAutofill.html",
    requiredFieldError: "requiredFieldError.html"
  };

  const screenCache = new Map();   // key -> { css, html, scripts }
  const snackbarCache = new Map(); // type -> { css, html }

  const STORAGE_KEY = "ux_checkin_knownGuests_v1";

  const state = {
    guest: {
      fullName: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
      gender: "",
      age: "",
      idType: "",
      idNumber: ""
    },
    stay: {
      checkin: "",
      checkout: "",
      adults: "",
      children: "",
      room: "",
      rate: "",
      deposit: "",
      discount: ""
    },
    booking: {
      days: 0,
      rateAmount: 0,
      total: 0,
      bookingId: "",
      transactionId: ""
    },
    payment: {
      method: "",
      cardMode: ""
    }
  };

  const RATE_MAP = {
    "king-75": 75,
    "queen-65": 65,
    "double-85": 85,
    "studio-75": 75,
    "studio-weekly-50": 50
  };

  let processingTimer = null;
  let renderToken = 0;

  let activeScriptDisposers = [];

  // Snackbar overlay
  let snackbarTimer = null;
  let snackbarLayer = null;

  // Scenario modal
  let scenarioModal = null;
  let scenarioModalLastFocus = null;

  function disposeActiveScripts() {
    for (const d of activeScriptDisposers) {
      try { d(); } catch {}
    }
    activeScriptDisposers = [];
  }

  function preUnmountCleanup() {
    const scanner = document.getElementById("scannerScreen");
    if (scanner && scanner.classList.contains("is-open")) {
      document.getElementById("closeBtn")?.click();
    }

    for (const v of $$("video", document)) {
      try {
        const so = v.srcObject;
        if (so && typeof so.getTracks === "function") {
          so.getTracks().forEach(t => { try { t.stop(); } catch {} });
        }
        v.srcObject = null;
      } catch {}
    }
  }

  function loadKnownGuests() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveKnownGuests(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  }

  function upsertKnownGuest(idNumber, fullName) {
    const list = loadKnownGuests();
    const idx = list.findIndex(x => x && x.idNumber === idNumber);
    const item = { idNumber, fullName: fullName || "" };
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    else list.push(item);
    saveKnownGuests(list);
  }

  function isReturningGuest(idNumber) {
    const scenario = getScenario();
    if (scenario.enforce?.forceReturning) return true;
    if (scenario.enforce?.forceNew) return false;

    const list = loadKnownGuests();
    if (list.some(x => x && x.idNumber === idNumber)) return true;

    const last = (idNumber || "").replace(/\D/g, "").slice(-1);
    if (!last) return false;
    return Number(last) % 2 === 0;
  }

  function randDigits(len) {
    let out = "";
    for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
    return out;
  }

  function money(n) {
    const num = Number.isFinite(n) ? n : 0;
    return `$ ${num.toFixed(2)}`;
  }

  function parseMoneyLike(v) {
    const s = String(v ?? "").trim();
    if (!s) return 0;
    const cleaned = s.replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatDateTime(dateStr, kind) {
    if (!dateStr) return "Time and Date";
    const base = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(base.getTime())) return "Time and Date";
    if (kind === "checkin") base.setHours(14, 0, 0, 0);
    else if (kind === "checkout") base.setHours(11, 0, 0, 0);
    else base.setHours(12, 0, 0, 0);

    return base.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function calcDays(checkin, checkout) {
    if (!checkin || !checkout) return 0;
    const d1 = new Date(checkin + "T00:00:00");
    const d2 = new Date(checkout + "T00:00:00");
    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
    const diff = Math.round((d2 - d1) / 86400000);
    return diff < 1 ? 1 : diff;
  }

  function recomputeBooking() {
    const days = calcDays(state.stay.checkin, state.stay.checkout);
    const rateAmount = RATE_MAP[state.stay.rate] ?? 0;
    const deposit = parseMoneyLike(state.stay.deposit);
    const discount = parseMoneyLike(state.stay.discount);
    const total = (days * rateAmount) + deposit - discount;

    state.booking.days = days;
    state.booking.rateAmount = rateAmount;
    state.booking.total = Number.isFinite(total) ? total : 0;

    if (!state.booking.bookingId) state.booking.bookingId = randDigits(10);
    if (!state.booking.transactionId) state.booking.transactionId = randDigits(13);
  }

  async function getScreen(key) {
    if (!SCREEN_FILES[key]) key = "dashboard";
    if (screenCache.has(key)) return screenCache.get(key);

    const file = SCREEN_FILES[key];
    const res = await fetch(file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
    const text = await res.text();

    const doc = new DOMParser().parseFromString(text, "text/html");
    const css = $$("style", doc).map(s => s.textContent || "").join("\n\n").trim();
    const scripts = $$("script", doc).map(s => ({
      src: s.getAttribute("src") || "",
      text: s.textContent || ""
    }));

    $$("script", doc).forEach(s => s.remove());
    const html = (doc.body ? doc.body.innerHTML : "").trim();

    const out = { css, html, scripts };
    screenCache.set(key, out);
    return out;
  }

  function runInlineScripts(scripts) {
    if (!Array.isArray(scripts) || scripts.length === 0) return;

    for (const s of scripts) {
      if (s.src) {
        const el = document.createElement("script");
        el.src = s.src;
        document.body.appendChild(el);
        continue;
      }

      const code = (s.text || "").trim();
      if (!code) continue;

      const timeouts = [];
      const intervals = [];

      const _setTimeout = window.setTimeout.bind(window);
      const _setInterval = window.setInterval.bind(window);
      const _clearTimeout = window.clearTimeout.bind(window);
      const _clearInterval = window.clearInterval.bind(window);

      const wrappedSetTimeout = (fn, ms, ...args) => {
        const id = _setTimeout(fn, ms, ...args);
        timeouts.push(id);
        return id;
      };
      const wrappedSetInterval = (fn, ms, ...args) => {
        const id = _setInterval(fn, ms, ...args);
        intervals.push(id);
        return id;
      };

      try {
        const fn = new Function("setTimeout", "setInterval", "clearTimeout", "clearInterval", code);
        fn(wrappedSetTimeout, wrappedSetInterval, _clearTimeout, _clearInterval);

        activeScriptDisposers.push(() => {
          for (const id of timeouts) { try { _clearTimeout(id); } catch {} }
          for (const id of intervals) { try { _clearInterval(id); } catch {} }
        });
      } catch (e) {
        console.error("Inline script execution failed:", e);
      }
    }
  }

  // -------------------------
  // Snackbar integration
  // -------------------------
  function ensureSnackbarLayer() {
    if (snackbarLayer) return snackbarLayer;
    snackbarLayer = document.createElement("div");
    snackbarLayer.id = "snackbarLayer";
    document.body.appendChild(snackbarLayer);

    const reposition = () => positionSnackbar();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { passive: true });

    activeScriptDisposers.push(() => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition);
    });

    return snackbarLayer;
  }

  function positionSnackbar() {
  if (!snackbarLayer || !snackbarLayer.classList.contains("is-visible")) return;

  const frame = document.querySelector(".frame");
  let frameBottomGap = 0;

  if (frame) {
    const rect = frame.getBoundingClientRect();

    // Horizontal center within frame
    snackbarLayer.style.left = `${rect.left + rect.width / 2}px`;
    const desiredWidth = Math.max(240, Math.min(520, rect.width - 32));
    snackbarLayer.style.width = `${desiredWidth}px`;

    // Distance from viewport bottom to frame bottom (so snackbar sits INSIDE the frame)
    frameBottomGap = Math.max(0, window.innerHeight - rect.bottom);
  } else {
    snackbarLayer.style.left = "50%";
    snackbarLayer.style.width = "min(520px, calc(100vw - 32px))";
    frameBottomGap = 0;
  }

  const bar = document.querySelector(".bottombar");
  const barH = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;

  // Always anchor via bottom
  snackbarLayer.style.top = "auto";
  snackbarLayer.style.bottom = `${frameBottomGap + barH + 16}px`;
}

function prefixCss(cssText, scopeSelector) {
  const out = [];
  const css = String(cssText || "");
  const blocks = css.split("}");

  for (const block of blocks) {
    const idx = block.indexOf("{");
    if (idx === -1) continue;

    const rawSel = block.slice(0, idx).trim();
    const body = block.slice(idx + 1);
    if (!rawSel) continue;

    // keep @rules as-is (rare in your snackbar templates)
    if (rawSel.startsWith("@")) {
      out.push(`${rawSel}{${body}}`);
      continue;
    }

    const selectors = rawSel.split(",").map(s => s.trim()).filter(Boolean);

    const prefixed = selectors
      .map(sel => {
        const clean = sel.replace(/\s+/g, " ").trim();

        // ✅ IMPORTANT: do not scope standalone-page layout rules
        if (clean === "html" || clean === "body") return null;

        // allow :root vars to live on the snackbar layer
        if (clean === ":root") return scopeSelector;

        if (clean === "*") return `${scopeSelector} *`;
        if (clean.startsWith(scopeSelector)) return clean;

        return `${scopeSelector} ${clean}`;
      })
      .filter(Boolean);

    if (prefixed.length === 0) continue;
    out.push(`${prefixed.join(", ")}{${body}}`);
  }

  return out.join("\n");
}

  async function loadSnackbarTemplate(type) {
    if (snackbarCache.has(type)) return snackbarCache.get(type);

    const file = SNACKBAR_FILES[type];
    const res = await fetch(file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
    const text = await res.text();

    const doc = new DOMParser().parseFromString(text, "text/html");
    const css = $$("style", doc).map(s => s.textContent || "").join("\n\n").trim();
    $$("script", doc).forEach(s => s.remove());

    const snackbarEl = doc.querySelector(".snackbar");
    const html = snackbarEl ? snackbarEl.outerHTML : "";
    const out = { css, html };
    snackbarCache.set(type, out);
    return out;
  }

  async function showSnackbar(type) {
    try {
      if (!SNACKBAR_FILES[type]) return;

      if (snackbarTimer) {
        clearTimeout(snackbarTimer);
        snackbarTimer = null;
      }

      const layer = ensureSnackbarLayer();
      const tpl = await loadSnackbarTemplate(type);

      const scope = `#snackbarLayer[data-snackbar="${type}"]`;
      const scopedCss = prefixCss(tpl.css, scope);

      const baseCss = `
      #snackbarLayer{
        position:fixed !important;
        display:bloack !important;
        height:auto !important;
        top:auto !important;
        background:transparent !important;
        padding:0 !important;
        margin:0 !important;
      }
      #snackbarLayer .snackbar{
        height:auto !important;
      }
      #snackbarLayer *{ box-sizing:border-box; }
      `.trim();

      if (!snackbarStyles.textContent.includes(scope)) {
        snackbarStyles.textContent = (snackbarStyles.textContent || "") + "\n\n" + baseCss + "\n\n" + scopedCss;
      }

      layer.setAttribute("data-snackbar", type);
      layer.innerHTML = tpl.html || "";
      layer.classList.add("is-visible");

      positionSnackbar();

      const dismissBtn = layer.querySelector("#dismissBtn");
      dismissBtn?.addEventListener("click", () => hideSnackbar(), { once: true });

      snackbarTimer = setTimeout(() => hideSnackbar(), 2500);
    } catch (e) {
      console.error("Snackbar error:", e)
    }
    snackbarLayer.style.height = "auto";
  }

  function hideSnackbar() {
    if (snackbarTimer) {
      clearTimeout(snackbarTimer);
      snackbarTimer = null;
    }
    if (!snackbarLayer) return;
    snackbarLayer.classList.remove("is-visible");
    snackbarLayer.removeAttribute("data-snackbar");
    snackbarLayer.innerHTML = "";
  }

  // -------------------------
  // Scenario Menu modal
  // -------------------------
  function ensureScenarioModal() {
    if (scenarioModal) return scenarioModal;

    const host = document.getElementById("scenarioModalContainer") || document.body;

    const modal = document.createElement("div");
    modal.id = "scenarioModal";
    modal.className = "scenario-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.tabIndex = -1;

    const ids = [0, 1, 2, 3, 4];

    modal.innerHTML = `
      <div class="scenario-overlay" data-close="1"></div>
      <div class="scenario-dialog" role="document" aria-labelledby="scenarioTitle">
        <div class="scenario-header">
          <h2 class="scenario-title" id="scenarioTitle">Scenario Menu</h2>
          <button class="scenario-close" type="button" aria-label="Close"><img class="close-btn" src="assets/close.svg" alt=""></button>
        </div>

        <form class="scenario-options" aria-label="Scenario selection">
          ${ids.map(id => {
            const s = SCENARIOS[id];
            return `
              <label class="scenario-option">
                <input type="radio" name="scenario" value="${id}" />
                <div class="scenario-option-text">
                  <div class="scenario-option-name">${s.title}</div>
                  <div class="scenario-option-desc">${s.desc}</div>
                </div>
              </label>
            `;
          }).join("")}
        </form>

        <div class="scenario-footer">
          <button class="scenario-btn scenario-reset" type="button">Reset to Open (0)</button>
          <button class="scenario-btn primary scenario-done" type="button">Done</button>
        </div>
      </div>
    `.trim();

    host.appendChild(modal);
    scenarioModal = modal;

    const overlay = modal.querySelector(".scenario-overlay");
    const closeBtn = modal.querySelector(".scenario-close");
    const doneBtn = modal.querySelector(".scenario-done");
    const resetBtn = modal.querySelector(".scenario-reset");
    const radios = $$('input[type="radio"][name="scenario"]', modal);

    const close = () => closeScenarioModal();

    overlay?.addEventListener("click", close);
    closeBtn?.addEventListener("click", close);
    doneBtn?.addEventListener("click", close);

    resetBtn?.addEventListener("click", () => {
      setScenarioId(0);
      closeScenarioModal();
      go("dashboard", { replace: true });
    });

    radios.forEach(r => {
      r.addEventListener("change", () => {
        if (r.checked) setScenarioId(Number(r.value));
      });
    });

    document.addEventListener("keydown", (e) => {
      if (!scenarioModal || scenarioModal.getAttribute("aria-hidden") === "true") return;
      if (e.key === "Escape") closeScenarioModal();
    });

    return scenarioModal;
  }

  function openScenarioModal() {
    ensureScenarioModal();
    scenarioModalLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const id = getScenarioId();
    $$('input[type="radio"][name="scenario"]', scenarioModal).forEach(r => {
      r.checked = Number(r.value) === id;
    });

    scenarioModal.classList.add("is-open");
    scenarioModal.setAttribute("aria-hidden", "false");
    scenarioModal.querySelector(".scenario-close")?.focus({ preventScroll: true });
  }

  function closeScenarioModal() {
    if (!scenarioModal) return;
    scenarioModal.classList.remove("is-open");
    scenarioModal.setAttribute("aria-hidden", "true");

    if (scenarioModalLastFocus) {
      try { scenarioModalLastFocus.focus({ preventScroll: true }); } catch {}
    }
    scenarioModalLastFocus = null;
  }

  // -------------------------
  // Render / navigation
  // -------------------------
  async function render(key) {
    const token = ++renderToken;

    if (processingTimer) {
      clearTimeout(processingTimer);
      processingTimer = null;
    }
    preUnmountCleanup();
    disposeActiveScripts();
    hideSnackbar();

    root.innerHTML = "";
    screenStyles.textContent = "";

    const screen = await getScreen(key);
    if (token !== renderToken) return;

    screenStyles.textContent = screen.css || "";
    root.innerHTML = screen.html || "";

    // Execute original inline scripts (scanner etc.) unchanged
    runInlineScripts(screen.scripts || []);

    bind(key);
    positionSnackbar();
  }

  function go(key, opts = {}) {
    if (!SCREEN_FILES[key]) key = "dashboard";
    const url = `#${key}`;
    if (opts.replace) history.replaceState({ screen: key }, "", url);
    else history.pushState({ screen: key }, "", url);
    render(key).catch(console.error);
  }

  function boot() {
    if (localStorage.getItem(SCENARIO_STORAGE_KEY) == null) {
      localStorage.setItem(SCENARIO_STORAGE_KEY, "0");
    } else {
      const id = normalizeScenarioId(localStorage.getItem(SCENARIO_STORAGE_KEY));
      localStorage.setItem(SCENARIO_STORAGE_KEY, String(id));
    }

    ensureScenarioModal();

    const initial = (location.hash || "").replace("#", "") || "dashboard";
    const start = SCREEN_FILES[initial] ? initial : "dashboard";
    history.replaceState({ screen: start }, "", `#${start}`);
    render(start).catch(console.error);
  }

  window.addEventListener("popstate", (e) => {
    const key = e.state?.screen || (location.hash || "").replace("#", "") || "dashboard";
    render(SCREEN_FILES[key] ? key : "dashboard").catch(console.error);
  });

  // -------------------------
  // UI helpers
  // -------------------------
  function setRowValue(label, value) {
    const rows = $$(".row", root);
    for (const r of rows) {
      const l = $(".left", r);
      const v = $(".right", r);
      if (!l || !v) continue;
      if (l.textContent.trim() === label) {
        v.textContent = value;
        return true;
      }
    }
    return false;
  }

  function safeSetField(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(value ?? "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyGuestPreset(preset) {
    if (!preset) return;
    safeSetField("fullName", preset.fullName);
    safeSetField("streetAddress", preset.streetAddress);
    safeSetField("city", preset.city);
    safeSetField("state", preset.state);
    safeSetField("zip", preset.zip);
    safeSetField("gender", preset.gender);
    safeSetField("age", preset.age);
    safeSetField("idType", preset.idType);
    safeSetField("idNumber", preset.idNumber);
  }

  function attachTripleClick(el, cb) {
    if (!el) return;

    let clicks = 0;
    let timer = null;
    const RESET_MS = 650;

    const reset = () => {
      clicks = 0;
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const onClick = () => {
      clicks += 1;
      if (clicks === 1) timer = setTimeout(reset, RESET_MS);
      if (clicks === 3) { reset(); cb(); }
    };

    el.addEventListener("click", onClick);
    activeScriptDisposers.push(() => el.removeEventListener("click", onClick));
  }

  function updateScenarioIndicatorOnDashboard() {
    const trigger = $("#scenarioTrigger", root) || $(".brand", root);
    if (!trigger) return;

    const existing = trigger.parentElement?.querySelector(".scenario-pill");
    if (existing) existing.remove();

    const scenario = getScenario();
    if (scenario.id === 0) return; // minimal indicator for Open

    const pill = document.createElement("span");
    pill.className = "scenario-pill";
    pill.textContent = `TS ${scenario.id}`;
    pill.title = `${scenario.id}) ${scenario.title}`;
    trigger.insertAdjacentElement("afterend", pill);
  }

  // -------------------------
  // Scenario 4: deterministic occupancy
  // -------------------------
  function hashStrToU32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seedU32) {
    const rand = mulberry32(seedU32);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function parseRoomTypeFromLabel(label) {
    // labels like "201 - King", "206 - Single Studio", "216 - Queen Size"
    const parts = String(label || "").split("-");
    if (parts.length < 2) return "Unknown";
    return parts.slice(1).join("-").trim();
  }

  function applyHighOccupancyToRoomSelect(selectEl, ratio, seedStr) {
    if (!selectEl) return;

    // Reset any prior modifications (safe)
    for (const opt of Array.from(selectEl.options)) {
      if (opt.dataset && opt.dataset.origLabel) {
        opt.textContent = opt.dataset.origLabel;
        delete opt.dataset.origLabel;
      }
      opt.disabled = false;
    }

    const all = Array.from(selectEl.options).filter(o => o.value && o.value !== "");
    if (all.length <= 2) return;

    const targetDisable = Math.floor(all.length * ratio);

    // Group by room type
    const groups = new Map(); // type -> options[]
    for (const opt of all) {
      const type = parseRoomTypeFromLabel(opt.textContent);
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(opt);
    }

    // Determine per-group minKeep (aim >=2 if possible)
    const groupKeys = Array.from(groups.keys()).sort();
    const minKeepByType = new Map();
    for (const type of groupKeys) {
      const size = groups.get(type).length;
      const minKeep = size >= 3 ? 2 : 1;
      minKeepByType.set(type, minKeep);
    }

    // Initial desired disables per group
    const disabledCountByType = new Map();
    let disabledSoFar = 0;

    for (const type of groupKeys) {
      const size = groups.get(type).length;
      const minKeep = minKeepByType.get(type);
      const desired = Math.floor(size * ratio);
      const capped = Math.min(desired, Math.max(0, size - minKeep));
      disabledCountByType.set(type, capped);
      disabledSoFar += capped;
    }

    // Add extra disables to meet overall target where possible (deterministic)
    let remaining = targetDisable - disabledSoFar;
    if (remaining > 0) {
      const seedBase = hashStrToU32(seedStr || "occupancy");
      const order = seededShuffle(groupKeys.slice(), seedBase ^ 0xA5A5A5A5);

      while (remaining > 0) {
        let progressed = false;
        for (const type of order) {
          if (remaining <= 0) break;
          const size = groups.get(type).length;
          const minKeep = minKeepByType.get(type);
          const current = disabledCountByType.get(type) || 0;
          const maxDisable = Math.max(0, size - minKeep);
          if (current < maxDisable) {
            disabledCountByType.set(type, current + 1);
            remaining -= 1;
            progressed = true;
          }
        }
        if (!progressed) break; // no more slack
      }
    }

    // Now choose exactly which rooms to disable in each group (seeded)
    for (const type of groupKeys) {
      const opts = groups.get(type).slice();
      const nDisable = disabledCountByType.get(type) || 0;
      if (nDisable <= 0) continue;

      const seed = hashStrToU32(`${seedStr}|${type}`);
      seededShuffle(opts, seed);

      const toDisable = opts.slice(0, nDisable);
      for (const opt of toDisable) {
        if (!opt.dataset.origLabel) opt.dataset.origLabel = opt.textContent;
        if (!opt.textContent.includes("(Occupied)")) opt.textContent = `${opt.textContent} (Occupied)`;
        opt.disabled = true;
      }
    }

    // Safety: ensure at least 1 available option overall
    const available = all.filter(o => !o.disabled);
    if (available.length === 0) {
      // Re-enable one deterministically
      const seed = hashStrToU32(`${seedStr}|fallback`);
      const shuffled = seededShuffle(all.slice(), seed);
      const opt = shuffled[0];
      opt.disabled = false;
      if (opt.dataset.origLabel) {
        opt.textContent = opt.dataset.origLabel;
        delete opt.dataset.origLabel;
      }
    }
  }

  // -------------------------
  // Screen bindings
  // -------------------------
  function bind(screenKey) {
    switch (screenKey) {
      case "dashboard": return bindDashboard();
      case "guestRegistration": return bindGuestRegistration();
      case "returningGuest": return bindReturningGuest();
      case "newGuest": return bindNewGuest();
      case "stayDetails": return bindStayDetails();
      case "bookingSummary": return bindBookingSummary();
      case "cashPayment": return bindCashPayment();
      case "cashPaymentSuccessful": return bindCashSuccess();
      case "cardPayment": return bindCardPayment();
      case "tapToPay": return bindTapToPay();
      case "cardPaymentProcessing": return;
      case "cardPaymentDeclined": return bindCardDeclined();
      case "cardPaymentSuccessful": return bindCardSuccess();
      case "receiptPrinted": return bindReceiptPrinted();
      default: return bindDashboard();
    }
  }

  function bindDashboard() {
    const checkinCard = $$(".card", root).find(c => c.textContent.trim() === "Check-In") || $(".card.primary", root);
    if (checkinCard) {
      checkinCard.style.cursor = "pointer";
      checkinCard.addEventListener("click", () => go("guestRegistration"));
      checkinCard.setAttribute("tabindex", "0");
      checkinCard.setAttribute("role", "button");
    }

    // Modal opens ONLY via triple-click on “Example XYZ Hotels”
    const trigger = $("#scenarioTrigger", root) || $$(".brand", root).find(b => b.textContent.trim() === "Example XYZ Hotels");
    if (trigger) attachTripleClick(trigger, () => openScenarioModal());

    updateScenarioIndicatorOnDashboard();
  }

  function bindGuestRegistration() {
    const scenario = getScenario();

    const form = $("#guestForm", root);
    const nextBtn = $(".primary-btn", root);
    const backBtn = $(".icon-btn[aria-label='Back']", root);

    const ids = ["fullName","streetAddress","city","state","zip","gender","age","idType","idNumber"];
    const requiredKeys = ["fullName","streetAddress","city","state","zip","gender","age","idNumber"];

    const getVal = (id) => ($("#" + id, root)?.value ?? "").trim();
    const setVal = (id, val) => { const el = $("#" + id, root); if (el) el.value = val ?? ""; };

    // Scenario 2: first time blank form to force required-field recovery moment
    if (scenario.id === 2 && scenario.enforce?.clearGuestFormOnce) {
      if (!sessionStorage.getItem("scenario2_guestClearedOnce")) {
        ids.forEach(id => setVal(id, ""));
        state.guest = { fullName:"", streetAddress:"", city:"", state:"", zip:"", gender:"", age:"", idType:"", idNumber:"" };
        sessionStorage.setItem("scenario2_guestClearedOnce", "1");
      }
    } else {
      setVal("fullName", state.guest.fullName);
      setVal("streetAddress", state.guest.streetAddress);
      setVal("city", state.guest.city);
      setVal("state", state.guest.state);
      setVal("zip", state.guest.zip);
      setVal("gender", state.guest.gender);
      setVal("age", state.guest.age);
      setVal("idType", state.guest.idType);
      setVal("idNumber", state.guest.idNumber);
    }

    backBtn?.addEventListener("click", () => go("dashboard"));

    nextBtn?.addEventListener("click", () => {
      if (form && typeof form.checkValidity === "function" && !form.checkValidity()) {
        showSnackbar("requiredFieldError");
        return;
      }

      state.guest = {
        fullName: getVal("fullName"),
        streetAddress: getVal("streetAddress"),
        city: getVal("city"),
        state: getVal("state"),
        zip: getVal("zip"),
        gender: getVal("gender"),
        age: getVal("age"),
        idType: getVal("idType"),
        idNumber: getVal("idNumber")
      };

      state.booking.bookingId = "";
      state.booking.transactionId = "";

      const returning = isReturningGuest(state.guest.idNumber);
      go(returning ? "returningGuest" : "newGuest");
    });

    // Scanner hooks: observe open/close without changing scanner code
    const openScannerBtn = $("#openScannerBtn", root);
    const scannerScreen = $("#scannerScreen", root);

    if (openScannerBtn && scannerScreen) {
      const snapshot = () => {
        const out = {};
        for (const k of ids) out[k] = (document.getElementById(k)?.value ?? "").trim();
        return out;
      };

      const applySnapshot = (snap) => {
        for (const k of ids) safeSetField(k, snap[k] ?? "");
      };

      const incomplete = (snap) => requiredKeys.some(k => !snap[k]);

      let scanSession = null;

      const onOpen = () => {
        const before = snapshot();
        scanSession = {
          scenarioId: scenario.id,
          before,
          baselineIncomplete: incomplete(before)
        };
      };

      openScannerBtn.addEventListener("click", onOpen, true);
      activeScriptDisposers.push(() => openScannerBtn.removeEventListener("click", onOpen, true));

      const observer = new MutationObserver(() => {
        const isOpen = scannerScreen.classList.contains("is-open");
        if (!scanSession) return;

        if (!isOpen) {
          const after = snapshot();
          const changedNewNonEmpty = ids.some(k => after[k] && after[k] !== scanSession.before[k]);

          // Scenario 2: force scan failure (no autofill)
          if (scanSession.scenarioId === 2) {
            applySnapshot(scanSession.before);
            showSnackbar("autofillFailed");
            scanSession = null;
            return;
          }

          // Scenario 1: force scan success (ensure autofill)
          if (scanSession.scenarioId === 1) {
            if (!changedNewNonEmpty) applyGuestPreset(SCENARIOS[1].presets?.guest);
            showSnackbar("autofillSuccess");
            scanSession = null;
            return;
          }

          // Default behavior (Scenario 0/3/4)
          if (changedNewNonEmpty) showSnackbar("autofillSuccess");
          else if (scanSession.baselineIncomplete) showSnackbar("autofillFailed");

          scanSession = null;
        }
      });

      observer.observe(scannerScreen, { attributes: true, attributeFilter: ["class"] });
      activeScriptDisposers.push(() => observer.disconnect());
    }
  }

  function bindReturningGuest() {
    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("ID Number", state.guest.idNumber || "0000000000");
    setRowValue("ID Type", state.guest.idType || "ID/DL/Passport");
    setRowValue("Rating", "4.6");

    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    setRowValue("Active Since", d.toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" }));
    setRowValue("Latest Activity", new Date().toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" }));

    const btns = $$(".btn", root);
    btns.find(b => b.textContent.trim() === "Cancel")?.addEventListener("click", () => go("dashboard"));
    btns.find(b => b.textContent.trim() === "Proceed")?.addEventListener("click", () => go("stayDetails"));
  }

  function bindNewGuest() {
    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("ID Number", state.guest.idNumber || "0000000000");
    setRowValue("ID Type", state.guest.idType || "ID/DL/Passport");

    const btns = $$(".btn", root);
    btns.find(b => b.textContent.trim() === "Skip")?.addEventListener("click", () => go("stayDetails"));

    btns.find(b => b.textContent.trim() === "Save")?.addEventListener("click", () => {
      if (state.guest.idNumber) upsertKnownGuest(state.guest.idNumber, state.guest.fullName);
      go("stayDetails");
    });
  }

  function bindStayDetails() {
    const scenario = getScenario();

    const backBtn = $(".icon-btn.back", root);
    const closeBtn = $(".icon-btn.close", root);
    const nextBtn = $(".primary-btn", root);

    const checkin = $("#checkin", root);
    const checkout = $("#checkout", root);
    const adults = $("#adults", root);
    const children = $("#children", root);
    const room = $("#room", root);
    const rate = $("#rate", root);
    const deposit = $("#deposit", root);
    const discount = $("#discount", root);

    if (checkin && state.stay.checkin) checkin.value = state.stay.checkin;
    if (checkout && state.stay.checkout) checkout.value = state.stay.checkout;
    if (adults && state.stay.adults) adults.value = state.stay.adults;
    if (children && state.stay.children) children.value = state.stay.children;
    if (room && state.stay.room) room.value = state.stay.room;
    if (rate && state.stay.rate) rate.value = state.stay.rate;
    if (deposit && state.stay.deposit) deposit.value = state.stay.deposit;
    if (discount && state.stay.discount) discount.value = state.stay.discount;

    // Scenario 4: apply deterministic 65% occupancy to room dropdown
    if (scenario.id === 4 && room) {
      const ratio = scenario.enforce?.occupancyRatio ?? 0.65;
      const seed = scenario.enforce?.occupancySeed ?? "high-occupancy-65";
      applyHighOccupancyToRoomSelect(room, ratio, seed);
    }

    backBtn?.addEventListener("click", () => history.back());
    closeBtn?.addEventListener("click", () => go("dashboard"));

    nextBtn?.addEventListener("click", () => {
      state.stay = {
        checkin: checkin?.value || "",
        checkout: checkout?.value || "",
        adults: adults?.value || "",
        children: children?.value || "",
        room: room?.value || "",
        rate: rate?.value || "",
        deposit: deposit?.value || "",
        discount: discount?.value || ""
      };

      if (!state.stay.checkin || !state.stay.checkout || !state.stay.room || !state.stay.rate) {
        showSnackbar("requiredFieldError");
        return;
      }

      recomputeBooking();
      go("bookingSummary");
    });
  }

  function bindBookingSummary() {
    const scenario = getScenario();

    const backBtn = $(".icon-btn.back", root);
    const closeBtn = $(".icon-btn.close", root);
    const cashBtn = $$(".btn", root).find(b => b.textContent.trim() === "Cash");
    const cardBtn = $$(".btn", root).find(b => b.textContent.trim() === "Card");

    recomputeBooking();

    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("Check-in", formatDateTime(state.stay.checkin, "checkin"));
    setRowValue("Check-out", formatDateTime(state.stay.checkout, "checkout"));
    setRowValue("No. of Days", String(state.booking.days || 0));
    setRowValue("Room Number", state.stay.room || "000");

    const guestCount = (parseInt(state.stay.adults || "0", 10) || 0) + (parseInt(state.stay.children || "0", 10) || 0);
    setRowValue("Guests", String(guestCount));

    setRowValue("Daily Rate", money(state.booking.rateAmount));
    setRowValue("Deposit", money(parseMoneyLike(state.stay.deposit)));
    setRowValue("Discount", money(parseMoneyLike(state.stay.discount)));
    setRowValue("Total Amount", money(state.booking.total));

    backBtn?.addEventListener("click", () => history.back());
    closeBtn?.addEventListener("click", () => go("dashboard"));

    cashBtn?.addEventListener("click", () => {
      state.payment.method = "cash";
      state.payment.cardMode = "";
      go("cashPayment");
    });

    cardBtn?.addEventListener("click", () => {
      state.payment.method = "card";
      state.payment.cardMode = "";
      go("cardPayment");
    });

    // Scenario bias
    if (scenario.enforce?.preferredPayment === "cash" && cashBtn) {
      cashBtn.classList.add("scenario-preferred");
      try { cashBtn.focus({ preventScroll: true }); } catch {}
    }
    if (scenario.enforce?.preferredPayment === "card" && cardBtn) {
      cardBtn.classList.add("scenario-preferred");
      try { cardBtn.focus({ preventScroll: true }); } catch {}
    }
  }

  function bindCashPayment() {
    const backBtn = $(".icon-btn[aria-label='Back']", root);
    const closeBtn = $(".icon-btn[aria-label='Close']", root);
    const yesBtn = $(".primary-btn", root);

    recomputeBooking();
    setRowValue("Total Amount", money(state.booking.total));

    backBtn?.addEventListener("click", () => history.back());
    closeBtn?.addEventListener("click", () => go("dashboard"));

    yesBtn?.addEventListener("click", () => {
      state.payment.method = "cash";
      state.payment.cardMode = "";
      if (!state.booking.transactionId) state.booking.transactionId = randDigits(13);
      go("cashPaymentSuccessful");
    });
  }

  function bindCashSuccess() {
    recomputeBooking();

    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("Check-in", formatDateTime(state.stay.checkin, "checkin"));
    setRowValue("Check-out", formatDateTime(state.stay.checkout, "checkout"));
    setRowValue("No. of Days", String(state.booking.days || 0));
    setRowValue("Room Number", state.stay.room || "000");

    const guestCount = (parseInt(state.stay.adults || "0", 10) || 0) + (parseInt(state.stay.children || "0", 10) || 0);
    setRowValue("Guests", String(guestCount));

    setRowValue("Booking ID", state.booking.bookingId || randDigits(10));
    setRowValue("Transaction Type", "Cash");
    setRowValue("Total Amount", money(state.booking.total));

    $(".primary-btn", root)?.addEventListener("click", () => go("receiptPrinted"));
  }

  function bindCardPayment() {
    const scenario = getScenario();

    const backBtn = $(".icon-btn[aria-label='Back']", root);
    const closeBtn = $(".icon-btn.close", root);
    const tapBtn = $(".tap-btn", root);
    const payBtn = $(".primary-btn", root);

    recomputeBooking();
    setRowValue("Total Amount", money(state.booking.total));

    backBtn?.addEventListener("click", () => history.back());
    closeBtn?.addEventListener("click", () => go("dashboard"));

    // Scenario 3: prefill declining card number if empty
    if (scenario.id === 3) {
      const preset = scenario.presets?.card;
      const cardNumberEl = $("#cardNumber", root);
      if (preset && cardNumberEl && !cardNumberEl.value) {
        cardNumberEl.value = preset.cardNumberDecline;
        cardNumberEl.dispatchEvent(new Event("input", { bubbles: true }));
        cardNumberEl.dispatchEvent(new Event("change", { bubbles: true }));

        const expiryEl = $("#expiry", root);
        const cvvEl = $("#cvv", root);
        const nameEl = $("#nameOnCard", root);
        if (expiryEl && !expiryEl.value) { expiryEl.value = preset.expiry; expiryEl.dispatchEvent(new Event("input", { bubbles: true })); }
        if (cvvEl && !cvvEl.value) { cvvEl.value = preset.cvv; cvvEl.dispatchEvent(new Event("input", { bubbles: true })); }
        if (nameEl && !nameEl.value) { nameEl.value = preset.nameOnCard; nameEl.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    }

    tapBtn?.addEventListener("click", () => {
      state.payment.method = "card";
      state.payment.cardMode = "tap";
      go("tapToPay");
    });

    payBtn?.addEventListener("click", () => {
      state.payment.method = "card";
      state.payment.cardMode = "manual";

      const cardNumber = ($("#cardNumber", root)?.value || "").replace(/\s+/g, "");
      const last = cardNumber.replace(/\D/g, "").slice(-1);

      let decline = last ? (Number(last) % 2 === 1) : false;

      // Scenario 3: force first attempt decline once per run
      if (scenario.id === 3 && scenario.enforce?.declineFirstCardAttempt) {
        if (!sessionStorage.getItem("scenario3_declinedOnce")) {
          decline = true;
          sessionStorage.setItem("scenario3_declinedOnce", "1");
        }
      }

      go("cardPaymentProcessing");
      processingTimer = setTimeout(() => {
        go(decline ? "cardPaymentDeclined" : "cardPaymentSuccessful", { replace: true });
      }, 4000);
    });
  }

  function bindTapToPay() {
    recomputeBooking();

    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("Room Number", state.stay.room || "000");
    setRowValue("Total Amount", money(state.booking.total));

    const closeBtn = $(".close-btn", root);
    closeBtn?.addEventListener("click", () => history.back());

    const canvas = $(".canvas", root);
    canvas?.addEventListener("click", (e) => {
      if (closeBtn && e.target && closeBtn.contains(e.target)) return;

      state.payment.method = "card";
      state.payment.cardMode = "tap";

      go("cardPaymentProcessing");
      processingTimer = setTimeout(() => {
        go("cardPaymentSuccessful", { replace: true });
      }, 4000);
    });
  }

  function bindCardDeclined() {
    recomputeBooking();

    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("Room Number", state.stay.room || "000");
    setRowValue("Booking ID", state.booking.bookingId || randDigits(10));
    setRowValue("Transaction Type", "Debit/Credit/NFC");
    setRowValue("Transaction ID", state.booking.transactionId || randDigits(13));
    setRowValue("Total Amount", money(state.booking.total));

    const btns = $$(".btn", root);
    btns.find(b => b.textContent.trim() === "Retry Payment")?.addEventListener("click", () => go("cardPayment"));
    btns.find(b => b.textContent.trim() === "Change Method")?.addEventListener("click", () => go("bookingSummary"));
  }

  function bindCardSuccess() {
    recomputeBooking();

    setRowValue("Guest", state.guest.fullName || "Full Name");
    setRowValue("Room Number", state.stay.room || "000");
    setRowValue("Booking ID", state.booking.bookingId || randDigits(10));
    setRowValue("Transaction Type", state.payment.cardMode === "tap" ? "NFC" : "Debit/Credit");
    setRowValue("Transaction ID", state.booking.transactionId || randDigits(13));
    setRowValue("Total Amount", money(state.booking.total));

    $(".primary-btn", root)?.addEventListener("click", () => go("receiptPrinted"));
  }

  function bindReceiptPrinted() {
    const btns = $$(".btn", root);
    const share = btns.find(b => b.textContent.trim() === "Share");
    const done = btns.find(b => b.textContent.trim() === "Done");

    share?.addEventListener("click", async () => {
      const text = `Receipt for ${state.guest.fullName || "Guest"} — Total ${money(state.booking.total)}`;
      try {
        if (navigator.share) await navigator.share({ title: "Receipt", text });
        else alert(text);
      } catch {}
    });

    done?.addEventListener("click", () => {
      state.guest = { fullName:"", streetAddress:"", city:"", state:"", zip:"", gender:"", age:"", idType:"", idNumber:"" };
      state.stay = { checkin:"", checkout:"", adults:"", children:"", room:"", rate:"", deposit:"", discount:"" };
      state.booking = { days:0, rateAmount:0, total:0, bookingId:"", transactionId:"" };
      state.payment = { method:"", cardMode:"" };
      go("dashboard");
    });
  }

  boot();
})();