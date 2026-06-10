/*
 * ══════════════════════════════════════════════════════════════
 *  SEAMEX GEO-ATTENDANCE  |  script.js  |  v09 — SharePoint Production Build
 *  Author : Prasidha Jagtap
 *  Role   : Assistant Manager – IT, Aditya Birla Group (Seamex)
 *  Office : Reliable Tech Park, Airoli, Maharashtra
 *  Deploy : https://www.onehruat.poornata.com/Pages/logintext.aspx
 *
 *  Hello, future developer. 👋
 *  Maintained by Prasidha Jagtap. Test on real Android + iOS.
 *
 *  WHAT CHANGED IN v08 vs v07
 *  ─────────────────────────────────────────────────────────────
 *  · #auth-sec manual login REPLACED by Azure AD hidden-field detection.
 *  · azureDetect() polls DOM for ctl00_ctl53_hdnPoornataId,
 *    ctl00_ctl53_hdnName, ctl00_ctl53_hdnCurrentUserEmail,
 *    ctl00_ctl53_hdnPictureUrl — all confirmed on logintext.aspx.
 *  · U.name and U.id populated from Azure ADFS session automatically.
 *  · U.photo added to state for identity banner display.
 *  · Identity banner rendered in main-sec header (photo + name + PID).
 *  · Manual fallback retained: if detection fails after 6s, user
 *    can enter PID manually (name sourced from email prefix).
 *  · All GPS, clock-in, clock-out, review, submit logic: UNCHANGED.
 *  · Supabase payload: UNCHANGED — user_name and employee_id now
 *    sourced from Azure ADFS instead of manual input.
 *
 *  FUNCTION INDEX
 *  ─────────────────────────────────────────────────────────────
 *  INIT          DOMContentLoaded
 *  AZURE DETECT  azureDetect() · azureApply() · azureFallback()   ← NEW v08
 *  AMBIENT       setTimeOfDay()
 *  THEME         applyTheme() · cycleTheme() · isDay()
 *  CLOCK LOOP    startMainLoop() · stopMainLoop()
 *  SVG HANDS     tickHands() · startHandLoop() · stopHandLoop() · rot()
 *  TRANSITIONS   pageTransition()
 *  VALIDATION    isValidName · isValidId · isValidLoc · sanitize
 *  RENDER MAIN   renderMain() · renderAzureBanner()               ← UPDATED v08
 *  CLOCK IN      btn-ci listener
 *  CLOCK OUT     btn-co listener  ← GPS freeze fixed here (FIX-05)
 *  RENDER REVIEW renderReview()
 *  MODAL         showModal() · closeModal()
 *  FIX CLOCK-IN  promptFixIn()
 *  REDO OUT      promptRedoOut() · showRedoBanner()
 *  SUBMIT        btn-submit listener
 *  SUCCESS       renderSuccess()
 *  RECOVERY      markBusy() · clearBusy() · recoverState()
 *  GPS           getCoords()   ← Promise.race fix lives here (FIX-05)
 *  LOCATION CACHE getCached() · saveLoc() · renderChips() · setupAC() · renderDrop()
 *  TOAST         toast()
 *  HELPERS       g · setTx · hide · show · nowISO · rnd · save · isNewDay · fmt · msDur · duration
 *
 *  SECURITY NOTES (Prasidha)
 *  ─────────────────────────────────────────────────────────────
 *  · Azure hidden fields: same-origin DOM read. No credentials transmitted.
 *  · PID validated as numeric-only. Name validated letters+spaces.
 *  · isValidName/isValidId/isValidLoc — strict regex on every input.
 *  · sanitize() — strips SQL/XSS chars before every DB write.
 *  · All DOM writes via .textContent — never .innerHTML (XSS).
 *  · Supabase anon key is public. Safe ONLY with RLS enabled.
 *  · GPS maximumAge:0 — always fresh, never cached position.
 *  · localStorage shape validated before trusting on restore.
 *  · isSubmitting flag — double-submit race guard.
 *
 *  BUG FIXES (all retained from v07)
 *  ─────────────────────────────────────────────────────────────
 *  FIX-01  renderMain() enforces section visibility on every call.
 *  FIX-02  Single rAF loop drives header clock + shift timer.
 *  FIX-03  Redo flow fully resets U.clockOut, lastActionDate, btn text.
 *  FIX-04  Ghost screen fully hidden + co-grp restored on GPS fail.
 *  FIX-05  GPS freeze fix: getCoords() uses true Promise.race.
 *  FIX-06  Recovery button: appears after 5s stuck, DOM-only restore.
 *
 *  MIGRATION CHECKLIST
 *  ─────────────────────────────────────────────────────────────
 *  [x] Azure AD SSO: DONE. azureDetect() reads ADFS hidden fields.
 *  [ ] GitHub Pages→SharePoint SPFx: bundle supabase locally.
 *      Change submitted_via to 'sharepoint' in payload.
 *  [ ] DB→Production: swap SUPABASE_URL + SUPABASE_KEY only.
 *  [ ] Multi-office: uncomment branch_code in payload.
 * ══════════════════════════════════════════════════════════════
 */

/* ── SUPABASE ────────────────────────────────────────────────
   Prasidha: Anon key is safe ONLY while RLS is active on 'attendance'.
   Policy: INSERT for anon. SELECT/UPDATE/DELETE: DENY.
   Rotate key immediately if RLS is ever disabled.
────────────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://svhbqvcabbzrxvndxtjm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aGJxdmNhYmJ6cnh2bmR4dGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTA0MjksImV4cCI6MjA5MDc4NjQyOX0.lYIsM5zN4uGKbP79avcKR_EaAlP5tu2N688OgZI6wZA';
const _db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── STATE ───────────────────────────────────────────────────
   Prasidha: U is the single source of truth.
   Every change calls save() to mirror to localStorage.
   Shape validated on restore — tampered data cannot bypass auth.
────────────────────────────────────────────────────────────── */
let U = {
  name: '', id: '', photo: '',           /* photo added v08 — Azure profile pic URL */
  /* Business fields — v09: read from SP hidden fields, saved to Supabase (Prasidha Jagtap) */
  businessName: '',   /* hdnBusinessName  e.g. "BMC01"                  */
  businessUnit: '',   /* hdnBusinessUnit  e.g. "SEA01"                  */
  businessDesc: '',   /* hdnBusinessDesc  e.g. "Birla Mgmt Centre Svcs" */
  buUnitDesc:   '',   /* hdnBuUnitDesc    e.g. "Seamex"                 */
  clockIn: null,  clockInCoords: '',  clockInLoc: '',
  clockOut: null, clockOutCoords: '', clockOutLoc: '',
  isClockedIn: false, submitted: false, lastActionDate: null,
  clockInCoordSource:  'gps',  /* 'gps' | 'ip' — set by getCoords() */
  clockOutCoordSource: 'gps'   /* tracked per-event, stored in payload */
};

let rafId        = null;  // requestAnimationFrame loop ID
let handIv       = null;  // setInterval ID for auth clock hands
let isSubmitting = false; // double-submit guard
let inRedoMode   = false; // true when user is redoing clock-out
let stuckTimer   = null;  // setTimeout ID for stuck-button detector

/* ── STORAGE KEYS ────────────────────────────────────────────
   Using smx_v06 key for backward compatibility so active shifts
   from v06 survive the upgrade. Change key only on schema break.
────────────────────────────────────────────────────────────── */
const KEY_USER    = 'smx_v06';
const KEY_PENDING = 'smx_pending';   /* v10: yesterday's unsubmitted shift held for next-day submit */
const KEY_ID      = 'smx_lastid';
const KEY_THEME   = 'smx_theme';
const KEY_LOCS    = 'smx_locs';
const MAX_LOCS    = 6;

/* ── HELPERS (hoisted) ───────────────────────────────────────
   Prasidha: Declared as `function` so they are fully hoisted.
   `const` arrow functions are NOT hoisted — using them above
   their declaration throws ReferenceError (temporal dead zone).
   Keep these as `function` declarations. Do not convert to const.
────────────────────────────────────────────────────────────── */

/** g — Prasidha: shorthand getElementById, used everywhere */
function g(id) { return document.getElementById(id); }

/** setTx — Prasidha: safely sets textContent, no-ops if element missing */
function setTx(id, v) { const e = g(id); if (e) e.textContent = v; }

/** hide — Prasidha: adds .hidden class (display:none!important in CSS) */
function hide(id) { g(id)?.classList.add('hidden'); }

/** show — Prasidha: removes .hidden class */
function show(id) { g(id)?.classList.remove('hidden'); }

/** nowISO — Prasidha: current timestamp as ISO 8601 string */
function nowISO() { return new Date().toISOString(); }

/** rnd — Prasidha: random element from array */
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** save — Prasidha: serializes U state to localStorage */
function save() { localStorage.setItem(KEY_USER, JSON.stringify(U)); }

/* ── CONTENT ARRAYS ──────────────────────────────────────────
   Prasidha: All UI copy here. Edit freely without touching logic.
────────────────────────────────────────────────────────────── */
const GREETINGS = [
  'Rare Sunday warrior spotted. Respect. 🦁',
  'New week, fresh resolve. Make it count! 🌟',
  'Tuesday energy — steady and purposeful. 💪',
  'Midweek momentum. You are in the thick of it. ⚡',
  'Thursday: the unsung hero of the week.',
  'Friday vibes. Finish line is right there. 🎉',
  'Closing the week strong. That is the Seamex way. 🚀'
];
const GHOST_NOTES = [
  'Your timings are being stored, safe and sound.',
  'Attendance logged with care — just like clockwork.',
  'Professional work happening behind the scenes.',
  'The database is receiving your day\'s hard work.',
  'Shift data is making its way in. Hang tight.'
];
const LOADER_MSGS = [
  'Starting your day…', 'One moment please…',
  'Getting things ready…', 'Just a tick…'
];

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════
   Prasidha: Order matters.
   1. Ambient time-of-day (CSS attr, no runtime cost after this)
   2. Saved theme (prevents flash of wrong theme)
   3. Daily greeting (day-of-week from GREETINGS)
   4. Pre-fill last Poornata ID (reduce login friction)
   5. Session restore OR fresh auth setup
   6. setupAC called ONCE here — not on every renderMain call
      (calling it multiple times stacks document.click listeners)
*/
window.addEventListener('DOMContentLoaded', () => {
  setTimeOfDay();

  const savedTheme = localStorage.getItem(KEY_THEME) || 'auto';
  _themeMode = savedTheme;
  applyTheme(_themeMode);

  setTx('daily-greet', GREETINGS[new Date().getDay()]);

  setupAC('in-loc',  'in-drop',  'in-chips');
  setupAC('out-loc', 'out-drop', 'out-chips');

  /* ── Session restore (Prasidha v08) ─────────────────────────────────────
     Validate shape before trusting. If valid same-day session exists,
     skip Azure detection and go straight to renderMain().
     Session carries U.name + U.id already resolved from Azure in prior load.
  */
  /* ── Session restore (v10 — two-button + next-day catch-up) ──────────
     Rules:
       · Same calendar day, not submitted        → resume today's shift.
       · Previous day, not submitted, has a punch → hold it as PENDING,
         start a fresh day (identity carried), prompt to submit it.
       · Submitted, or empty previous day         → discard, start fresh.
     The PENDING shift is stored under its own key so it survives even if
     the user closes the app before deciding. It is offered again on the
     next open until submitted or explicitly discarded.
  */
  try {
    const raw = localStorage.getItem(KEY_USER);
    if (raw) {
      const p = JSON.parse(raw);
      const idOK = p?.name && typeof p.name === 'string' &&
                   p?.id   && typeof p.id   === 'string';

      if (idOK && !isNewDay(p.lastActionDate)) {
        /* Same day — resume exactly where they left off */
        U = p;
        renderMain();
        return;
      }

      if (idOK && !p.submitted && isNewDay(p.lastActionDate) && (p.clockIn || p.clockOut)) {
        /* Previous day, never submitted — hold it and start fresh */
        localStorage.setItem(KEY_PENDING, JSON.stringify(p));
        U = freshDay(p);
        save();
        renderMain();         /* checkPending() inside will raise the prompt */
        return;
      }

      if (idOK) {
        /* Submitted yesterday, or an empty previous day — clean start, keep identity */
        U = freshDay(p);
        save();
        renderMain();
        return;
      }

      localStorage.removeItem(KEY_USER);
    }
  } catch { localStorage.removeItem(KEY_USER); }

  /* ── Fresh session: run Azure detection ─────────────────────────────── */
  azureDetect();
});

/* ══════════════════════════════════════════════════════════════
   AZURE AD DETECTION — v08 (Prasidha Jagtap)

   Replaces the manual #auth-sec login form from v07.
   Reads identity directly from Classic SharePoint hidden fields
   written by Azure ADFS after login on logintext.aspx.

   CONFIRMED FIELD IDs (from logintext.aspx page source):
     ctl00_ctl53_hdnPoornataId       → U.id   (numeric, e.g. "446686")
     ctl00_ctl53_hdnName             → U.name (e.g. "Prasidha Jagtap")
     ctl00_ctl53_hdnCurrentUserEmail → email  (e.g. "prasidha.jagtap@adityabirla.com")
     ctl00_ctl53_hdnPictureUrl       → photo  (URL to profile thumbnail)

   STRATEGY:
     Classic ASP.NET pages may populate hidden fields AFTER
     DOMContentLoaded via code-behind. We poll every 400ms for
     up to 6 seconds before falling to fallback.

   SECURITY (Prasidha):
     · Same-origin DOM read. No credentials transmitted.
     · PID validated numeric-only before accepting.
     · Name validated letters+spaces before accepting.
     · Photo URL not validated — only used as img src (safe).

   FUTURE MIGRATION NOTE:
     Replace azureDetect() with MSAL.js token extraction when
     portal moves to SPFx modern pages. Keep azureApply() call
     signature unchanged — renderMain() and Supabase payload
     both consume U.name + U.id with no changes needed.
══════════════════════════════════════════════════════════════ */

var _azurePollCount = 0;
var _azurePollMax   = 15;   /* 15 × 400ms = 6 seconds max */
var _azurePollTimer = null;

/**
 * azureDetect — Prasidha Jagtap (v08)
 * Polls DOM for Azure ADFS hidden fields. Stops at first valid PID.
 * Shows auth screen with detecting state while polling.
 */
function azureDetect() {
  _azurePollCount = 0;

  /* Show auth-sec in detecting state while we poll */
  show('auth-sec');
  hide('main-sec');
  hide('auth-manual-grp');
  show('auth-detecting');
  setTx('auth-detect-msg', 'Connecting to Azure AD…');

  _azurePollTimer = setInterval(function () {
    _azurePollCount++;

    /* ── Read all four confirmed hidden fields (Prasidha Jagtap) ─── */
    /* ── Identity fields (Prasidha Jagtap) ── */
    var pidEl   = document.getElementById('ctl00_ctl53_hdnPoornataId')
               || document.querySelector('input.hdnPoornataId')
               || document.querySelector('input[name*="hdnPoornataId"]');

    var nameEl  = document.getElementById('ctl00_ctl53_hdnName')
               || document.querySelector('input.hdnName')
               || document.querySelector('input[name*="hdnName"]');

    var emailEl = document.getElementById('ctl00_ctl53_hdnCurrentUserEmail')
               || document.querySelector('input.hdnCurrentUserEmail')
               || document.querySelector('input[name*="hdnCurrentUserEmail"]');

    var photoEl = document.getElementById('ctl00_ctl53_hdnPictureUrl')
               || document.querySelector('input.hdnPictureUrl')
               || document.querySelector('input[name*="hdnPictureUrl"]');

    /* ── Business fields — v09 (Prasidha Jagtap) ── */
    /* Confirmed hidden fields on logintext.aspx / TestingText.aspx      */
    /* hdnBusinessName → BU code e.g. "BMC01"                            */
    /* hdnBusinessDesc → Full name e.g. "Birla Mgmt Centre Services"     */
    /* hdnBusinessUnit → Unit code e.g. "SEA01"                          */
    /* hdnBuUnitDesc   → Unit name e.g. "Seamex"                         */
    var bizNameEl = document.getElementById('ctl00_ctl53_hdnBusinessName')
               || document.querySelector('input.hdnBusinessName')
               || document.querySelector('input[name*="hdnBusinessName"]');

    var bizUnitEl = document.getElementById('ctl00_ctl53_hdnBusinessUnit')
               || document.querySelector('input.hdnBusinessUnit')
               || document.querySelector('input[name*="hdnBusinessUnit"]');

    var bizDescEl = document.getElementById('ctl00_ctl53_hdnBusinessDesc')
               || document.querySelector('input.hdnBusinessDesc')
               || document.querySelector('input[name*="hdnBusinessDesc"]');

    var buDescEl  = document.getElementById('ctl00_ctl53_hdnBuUnitDesc')
               || document.querySelector('input.hdnBuUnitDesc')
               || document.querySelector('input[name*="hdnBuUnitDesc"]');

    var pid         = (pidEl     ? pidEl.value     : '').trim();
    var name        = (nameEl    ? nameEl.value    : '').trim();
    var email       = (emailEl   ? emailEl.value   : '').trim();
    var photo       = (photoEl   ? photoEl.value   : '').trim();
    var bizName     = (bizNameEl ? bizNameEl.value : '').trim();
    var bizUnit     = (bizUnitEl ? bizUnitEl.value : '').trim();
    var bizDesc     = (bizDescEl ? bizDescEl.value : '').trim();
    var buDesc      = (buDescEl  ? buDescEl.value  : '').trim();

    /* Derive name from email prefix if hidden name field empty */
    if (!name && email) name = azureDeriveNameFromEmail(email);

    setTx('auth-detect-msg', 'Detecting… (' + _azurePollCount + ')');

    if (isValidId(pid)) {
      clearInterval(_azurePollTimer);
      azureApply(pid, name || 'Employee', email, photo,
        { bizName, bizUnit, bizDesc, buDesc },
        'Azure ADFS · Hidden Fields');
      return;
    }

    if (_azurePollCount >= _azurePollMax) {
      clearInterval(_azurePollTimer);
      /* Detection exhausted — show manual PID entry fallback */
      azureFallback(email, name);
    }
  }, 400);
}

/**
 * azureApply — Prasidha Jagtap (v08)
 * Stores resolved Azure identity into U and starts the app.
 * Security: PID and name re-validated before accepting.
 * @param {string} pid
 * @param {string} name
 * @param {string} email
 * @param {string} photo
 * @param {string} source
 */
function azureApply(pid, name, email, photo, bizFields, source) {
  /* Handle calls without bizFields (manual fallback path) */
  if (typeof bizFields === 'string') { source = bizFields; bizFields = {}; }

  /* SECURITY: re-validate before trusting (Prasidha) */
  if (!isValidId(pid)) {
    toast('Identity check failed. Please enter your ID manually.', 'err');
    azureFallback(email, name);
    return;
  }

  /* Sanitize name — strip any injected chars (defence-in-depth) */
  const safeName = name.trim().replace(/[^a-zA-Z\s]/g, '').trim() || 'Employee';

  U.name  = safeName;
  U.id    = pid;
  U.photo = photo || '';
  /* v09: business fields from SP hidden fields (Prasidha Jagtap) */
  U.businessName = (bizFields && bizFields.bizName) || U.businessName || '';
  U.businessUnit = (bizFields && bizFields.bizUnit) || U.businessUnit || '';
  U.businessDesc = (bizFields && bizFields.bizDesc) || U.businessDesc || '';
  U.buUnitDesc   = (bizFields && bizFields.buDesc)  || U.buUnitDesc   || '';
  U.lastActionDate = nowISO();
  localStorage.setItem(KEY_ID, pid);
  save();

  console.info('[Seamex|Prasidha v08] Azure identity resolved via:', source);
  window.dispatchEvent(new CustomEvent('poornataIdentityReady', {
    detail: { pid, name: safeName, email, photo, source }, bubbles: true
  }));

  /* Show brief confirmation then go to main */
  setTx('auth-detect-msg', '✓ Verified — ' + safeName);
  setTimeout(function () {
    pageTransition(function () { renderMain(); }, 'Starting your day…');
  }, 700);
}

/**
 * azureFallback — Prasidha Jagtap (v08)
 * Shows manual PID entry when auto-detection fails.
 * Name pre-filled from email prefix if available.
 * @param {string} email
 * @param {string} name
 */
function azureFallback(email, name) {
  hide('auth-detecting');
  show('auth-manual-grp');

  /* Pre-fill name if we got it from email even without PID */
  const nameInp = g('inp-name');
  if (nameInp && name && !nameInp.value) nameInp.value = name;

  /* Pre-fill last used PID */
  const lastId = localStorage.getItem(KEY_ID);
  const idInp  = g('inp-id');
  if (idInp && lastId && !idInp.value) idInp.value = lastId;

  /* Store email for later use in payload even if not displayed */
  if (email) U._azureEmail = email;

  setupLoginValidation();
  toast('Auto-detect failed. Please enter your Poornata ID.', 'err');
}

/**
 * azureDeriveNameFromEmail — Prasidha Jagtap (v08)
 * e.g. "prasidha.jagtap@adityabirla.com" → "Prasidha Jagtap"
 * @param {string} email
 * @returns {string}
 */
function azureDeriveNameFromEmail(email) {
  if (!email || !email.includes('@')) return '';
  const prefix = email.split('@')[0];
  if (/^\d+$/.test(prefix)) return '';
  return prefix.replace(/[._-]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

/* ══════════════════════════════════════════════════════════════
   TIME-OF-DAY AMBIENT
   Prasidha: Sets data-tod on body. CSS handles all animation.
   dawn(5-9am) · day(9-15) · dusk(15-18) · night(18-5)
*/
function setTimeOfDay() {
  const h = new Date().getHours();
  const tod = h >= 5  && h < 9  ? 'dawn'
            : h >= 9  && h < 15 ? 'day'
            : h >= 15 && h < 18 ? 'dusk'
            : 'night';
  document.body.setAttribute('data-tod', tod);
}

/* ══════════════════════════════════════════════════════════════
   THEME SYSTEM
   Prasidha: Modes: 'auto' (time-based) | 'light' | 'dark'.
   Preference saved to localStorage. All .t-ico and .t-lbl
   elements across both footers updated together.
*/
let _themeMode = 'auto';

/** applyTheme — Prasidha: resolves effective theme and updates DOM */
function applyTheme(mode) {
  const eff = mode === 'auto' ? (isDay() ? 'light' : 'dark') : mode;
  document.documentElement.setAttribute('data-theme', eff);
  const ico = eff === 'dark' ? '☀️' : '🌙';
  const lbl = eff === 'dark' ? 'Light' : 'Dark';
  document.querySelectorAll('.t-ico').forEach(e => e.textContent = ico);
  document.querySelectorAll('.t-lbl').forEach(e => e.textContent = lbl);
}

/** cycleTheme — Prasidha: called by onclick on theme buttons */
function cycleTheme() {
  const next = { auto: 'light', light: 'dark', dark: 'auto' };
  _themeMode = next[_themeMode] || 'auto';
  localStorage.setItem(KEY_THEME, _themeMode);
  applyTheme(_themeMode);
}

/** isDay — Prasidha: true between 6am and 6pm */
const isDay = () => { const h = new Date().getHours(); return h >= 6 && h < 18; };

/* ══════════════════════════════════════════════════════════════
   MAIN RAF LOOP — FIX-02 (Prasidha)
   Single requestAnimationFrame loop drives BOTH the live header
   clock AND the shift timer from the same Date.now() call.
   Zero lag, zero drift. Runs only while main-sec is visible.
*/

/** startMainLoop — Prasidha: starts unified clock + timer rAF loop */
function startMainLoop() {
  stopMainLoop();
  let lastSec = -1;

  function loop() {
    const d  = new Date();
    const sc = d.getSeconds();

    if (sc !== lastSec) {
      lastSec = sc;
      const hh = d.getHours()  .toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      const ss = sc.toString().padStart(2, '0');

      setTx('hdr-clock', `${hh}:${mm}:${ss}`);
      setTx('hdr-date', d.toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      }));

      /* Shift timer — live only while clocked in and not yet clocked out (v10) */
      if (U.clockIn && !U.clockOut && !U.submitted) {
        setTx('timer-val', msDur(Date.now() - new Date(U.clockIn).getTime()));
      }
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

/** stopMainLoop — Prasidha: cancels the rAF loop */
function stopMainLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

/* ══════════════════════════════════════════════════════════════
   SVG CLOCK HANDS
   Prasidha: JS sets rotation angle once/second.
   CSS cubic-bezier transition does the smooth easing (GPU-composited).
*/

/** tickHands — Prasidha: sets H/M/S SVG hand rotation angles */
function tickHands(hId, mId, sId) {
  const d  = new Date();
  const sc = d.getSeconds();
  const mn = d.getMinutes() + sc / 60;
  const hr = (d.getHours() % 12) + mn / 60;
  rot(hId, hr * 30);
  rot(mId, mn * 6);
  rot(sId, sc * 6);
}

/** startHandLoop — Prasidha: starts 1s interval for auth clock */
function startHandLoop(hId = 'ac-h', mId = 'ac-m', sId = 'ac-s') {
  tickHands(hId, mId, sId);
  handIv = setInterval(() => tickHands(hId, mId, sId), 1000);
}

/** stopHandLoop — Prasidha: clears auth clock interval */
function stopHandLoop() { clearInterval(handIv); handIv = null; }

/** rot — Prasidha: applies CSS rotation to SVG element */
function rot(id, deg) {
  const el = g(id);
  if (el) el.style.transform = `rotate(${deg}deg)`;
}

/* ══════════════════════════════════════════════════════════════
   PAGE TRANSITION — CRED-style clock overlay
   Prasidha: Full-screen overlay with ticking clock + floating
   time emojis between screens. No dependencies.
*/
const PT_MSGS   = ['Switching view…', 'One moment…', 'Loading…', 'Just a tick…'];
const PT_EMOJIS = ['⏱', '⌛', '🕐', '⏳', '🕑', '⏰'];

/** pageTransition — Prasidha: shows animated overlay, runs fn() mid-fade */
function pageTransition(fn, msg) {
  const ov   = g('pg-tr');
  const msgEl = g('pt-msg');
  const parts = g('pt-parts');
  if (!ov) { if (fn) fn(); return; }

  if (msgEl) msgEl.textContent = msg || rnd(PT_MSGS);

  /* Spawn floating time emojis */
  if (parts) {
    parts.innerHTML = '';
    [...PT_EMOJIS].sort(() => Math.random() - .5).slice(0, 4).forEach((em, i) => {
      const p = document.createElement('div');
      p.className = 'pt-p';
      p.textContent = em;
      p.style.cssText = `left:${12 + i * 22}%;bottom:${8 + Math.random() * 18}px;animation-delay:${i * .14}s`;
      parts.appendChild(p);
    });
  }

  ov.classList.add('on');
  setTimeout(() => { if (fn) fn(); }, 260);
  setTimeout(() => ov.classList.remove('on'), 960);
}

/* ══════════════════════════════════════════════════════════════
   INPUT VALIDATION — Prasidha
   SECURITY: all three validators enforced consistently on every
   input, every page, re-checked on every button click.

   isValidName: letters + spaces, min 2 chars.
   isValidId  : digits only, 3–12 chars.
   isValidLoc : letters/digits/spaces/hyphens ONLY.
                Blocks all SQL-injection and HTML-injection chars.
   sanitize   : strips dangerous chars before any DB write.
                Supabase parameterized queries are the baseline.
                This is defence-in-depth.
*/
const isValidName = s => /^[a-zA-Z\s]{2,60}$/.test(s.trim());
const isValidId   = s => /^[0-9]{3,12}$/.test(s.trim());

/** isValidLoc — Prasidha: BLOCKS < > " ' ; = + # | \ / ( ) { } % @ ` */
const isValidLoc  = s => /^[a-zA-Z0-9 \-]{2,60}$/.test(s.trim());

/** sanitize — Prasidha: final strip before any DB write */
const sanitize = s =>
  s.trim().replace(/[<>"'`%;(){}\\\/=+|#@]/g, '').slice(0, 60);

/** showErrIf — Prasidha: helper to toggle inline error visibility */
const showErrIf = (id, cond) => {
  const el = g(id);
  if (el) el.style.display = cond ? 'block' : 'none';
};

/** validateLoc — Prasidha: validates location input, shows error, returns bool */
function validateLoc(raw, errId) {
  if (!raw.trim()) { toast('Please enter a location name.'); return false; }
  if (!isValidLoc(raw)) {
    showErrIf(errId, true);
    toast('Use letters, numbers, spaces or hyphens only.', 'err'); return false;
  }
  showErrIf(errId, false);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   LOGIN VALIDATION
   Prasidha: Enables Start Day only when both fields pass.
*/
function setupLoginValidation() {
  const nIn = g('inp-name'), iIn = g('inp-id'), btn = g('btn-start');
  if (!nIn || !iIn || !btn) return;

  const check = () => {
    const n = nIn.value.trim(), i = iIn.value.trim();
    showErrIf('err-name', n && !isValidName(n));
    showErrIf('err-id',   i && !isValidId(i));
    btn.disabled = !(isValidName(n) && isValidId(i));
  };
  nIn.addEventListener('input', check);
  iIn.addEventListener('input', check);
}

/* ══════════════════════════════════════════════════════════════
   START DAY
   Prasidha: Re-validates on click (not just on input events).
*/
g('btn-start').addEventListener('click', (e) => { e.preventDefault();
  const name = g('inp-name').value.trim();
  const id   = g('inp-id').value.trim();

  /* SECURITY: Re-validate on click (Prasidha v08) */
  if (!isValidName(name) || !isValidId(id)) {
    toast('Check your details.', 'err'); return;
  }

  /* v08: route through azureApply so identity is stored correctly.
     Photo will be empty in manual fallback — that is acceptable. */
  azureApply(id, name, U._azureEmail || '', U.photo || '', 'Manual Fallback');
});

/* ══════════════════════════════════════════════════════════════
   RENDER MAIN — central state router
   FIX-01 (Prasidha): enforces section visibility at every call.
   Called from btn-start AND session restore. Both paths show
   main-sec and hide auth-sec correctly.
*/
function renderMain() {
  /* FIX-01: Always enforce correct section visibility */
  hide('auth-sec');
  show('main-sec');

  setTx('disp-name', U.name);
  setTx('disp-id',   U.id);

  /* v08: render Azure identity banner at top of main (Prasidha) */
  renderAzureBanner();

  startMainLoop();

  if (U.submitted) { renderSuccess(); return; }

  /* v10: both punch blocks live at once — user chooses in or out, any order */
  show('status-card');
  show('ci-grp');
  show('co-grp');
  show('btn-submit');
  show('save-note');
  hide('ghost-scr');
  hide('suc-card');

  renderPunchDisplay();
  renderChips('in-loc',  'in-chips',  'in-drop');
  renderChips('out-loc', 'out-chips', 'out-drop');

  checkPending();
}

/**
 * renderPunchDisplay — v10
 * Paints the two punch blocks and the hero shift timer from U state.
 * Safe to call repeatedly.
 */
function renderPunchDisplay() {
  setTx('ci-time', U.clockIn  ? fmt(U.clockIn)  : '--:-- --');
  setTx('ci-loc',  U.clockIn  ? (U.clockInLoc  + sourceTag(U.clockInCoordSource))  : 'Not punched yet');
  setTx('co-time', U.clockOut ? fmt(U.clockOut) : '--:-- --');
  setTx('co-loc',  U.clockOut ? (U.clockOutLoc + sourceTag(U.clockOutCoordSource)) : 'Not punched yet');

  const ciBtn = g('btn-ci'); if (ciBtn && ciBtn.textContent !== 'Fetching location…') ciBtn.textContent = U.clockIn  ? 'Update' : 'Record now';
  const coBtn = g('btn-co'); if (coBtn && coBtn.textContent !== 'Fetching location…') coBtn.textContent = U.clockOut ? 'Update' : 'Record now';

  const dot = g('sh-dot'), lbl = g('sh-lbl-txt');
  if (U.clockIn && !U.clockOut) {
    setTx('timer-val', msDur(Date.now() - new Date(U.clockIn).getTime()));
    if (lbl) lbl.textContent = 'Current shift';
    if (dot) dot.classList.add('live');
  } else if (U.clockIn && U.clockOut) {
    setTx('timer-val', duration(U.clockIn, U.clockOut));
    if (lbl) lbl.textContent = 'Shift complete';
    if (dot) dot.classList.remove('live');
  } else if (!U.clockIn && U.clockOut) {
    setTx('timer-val', '--:--:--');
    if (lbl) lbl.textContent = 'Clock-in missing';
    if (dot) dot.classList.remove('live');
  } else {
    setTx('timer-val', '00:00:00');
    if (lbl) lbl.textContent = 'Not started';
    if (dot) dot.classList.remove('live');
  }
}

/** sourceTag — appends a note when location came from network (IP) not GPS */
function sourceTag(src) { return src === 'ip' ? '  ·  approx (network)' : ''; }

/**
 * renderAzureBanner — Prasidha Jagtap (v08)
 * Renders the Azure identity strip at the top of main-sec.
 * Shows profile photo (or initials), name, PID, and verified badge.
 * Called on every renderMain() — safe to call multiple times.
 * Security: all writes via textContent. Photo via img.src only.
 */
function renderAzureBanner() {
  const banner = g('azure-banner');
  if (!banner) return;

  /* Photo or initials in az-banner (Prasidha) */
  const img  = g('az-photo');
  const init = g('az-initials');

  if (img && U.photo) {
    img.src = U.photo;
    img.style.display = 'block';
    img.onerror = function () {
      img.style.display = 'none';
      if (init) {
        const parts    = (U.name || 'E').trim().split(' ');
        init.textContent = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
        init.style.display = 'flex';
      }
    };
    if (init) init.style.display = 'none';
  } else if (init) {
    const parts    = (U.name || 'E').trim().split(' ');
    init.textContent = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    init.style.display = 'flex';
    if (img) img.style.display = 'none';
  }

  /* v09: Populate main-hdr avatar slot beside name/PID (Prasidha Jagtap) */
  const mhlPhoto    = g('mhl-photo');
  const mhlInitials = g('mhl-initials');
  if (mhlPhoto && mhlInitials) {
    const nameParts = (U.name || 'E').trim().split(' ');
    const initials  = (nameParts[0][0] + (nameParts[1] ? nameParts[1][0] : '')).toUpperCase();
    if (U.photo) {
      mhlPhoto.src = U.photo;
      mhlPhoto.style.display = 'block';
      mhlInitials.style.display = 'none';
      mhlPhoto.onerror = function() {
        mhlPhoto.style.display = 'none';
        mhlInitials.textContent = initials;
        mhlInitials.style.display = 'flex';
      };
    } else {
      mhlPhoto.style.display = 'none';
      mhlInitials.textContent = initials;
      mhlInitials.style.display = 'flex';
    }
  }

  setTx('az-name', U.name || '—');
  setTx('az-pid',  U.id   || '—');
  banner.style.display = 'flex';
}

/* ══════════════════════════════════════════════════════════════
   CLOCK IN / CLOCK OUT — v10 record-or-override model

   Both buttons are live all day. The user picks either, any order,
   any number of times. Tapping a button that already has a time
   shows an override confirm, then overwrites the time AND location
   with the fresh punch. Everything stays on-device until Submit.
*/

/** btn-ci — record or update the clock-in punch */
g('btn-ci').addEventListener('click', (e) => { e.preventDefault();
  if (U.submitted) { toast('This shift is already submitted.', 'err'); return; }
  if (U.clockIn) {
    showModal({
      icon: '⚠️', title: 'Replace clock-in time?',
      body: `You already recorded ${fmt(U.clockIn)} at ${U.clockInLoc || '—'}. Recording now replaces it with your new time and location.`,
      buttons: [
        { label: 'Replace', cls: 'btn-ora',  fn: () => doPunch('in') },
        { label: 'Cancel',  cls: 'btn-edit', fn: null }
      ]
    });
  } else {
    doPunch('in');
  }
});

/** btn-co — record or update the clock-out punch */
g('btn-co').addEventListener('click', (e) => { e.preventDefault();
  if (U.submitted) { toast('This shift is already submitted.', 'err'); return; }
  if (U.clockOut) {
    showModal({
      icon: '⚠️', title: 'Replace clock-out time?',
      body: `You already recorded ${fmt(U.clockOut)} at ${U.clockOutLoc || '—'}. Recording now replaces it with your new time and location.`,
      buttons: [
        { label: 'Replace', cls: 'btn-ora',  fn: () => doPunch('out') },
        { label: 'Cancel',  cls: 'btn-edit', fn: null }
      ]
    });
  } else {
    doPunch('out');
  }
});

/**
 * doPunch — v10
 * Validates the location, captures coordinates, and writes the punch.
 * Re-enable is guaranteed via finally (retains the FIX-05 freeze guard).
 * @param {'in'|'out'} kind
 */
async function doPunch(kind) {
  const inputId = kind === 'in' ? 'in-loc'      : 'out-loc';
  const errId   = kind === 'in' ? 'err-in-loc'  : 'err-out-loc';
  const btnId   = kind === 'in' ? 'btn-ci'      : 'btn-co';

  const raw = g(inputId).value;
  if (!validateLoc(raw, errId)) return;

  const btn = g(btnId);
  btn.disabled = true; btn.textContent = 'Fetching location…';
  markBusy();

  let coords = null;
  try {
    coords = await getCoords();
  } catch (e) {
    console.error('[Seamex] GPS exception:', e);
  } finally {
    /* Guaranteed re-enable on every outcome (FIX-05) */
    clearBusy();
    btn.disabled = false;
    btn.textContent = (kind === 'in' ? U.clockIn : U.clockOut) ? 'Update' : 'Record now';
  }

  /* getCoords() already toasts on failure */
  if (!coords) return;

  const loc = sanitize(raw);
  saveLoc(loc);
  const ts = nowISO();

  if (kind === 'in') {
    U.clockIn = ts; U.clockInCoords = coords; U.clockInLoc = loc;
    U.clockInCoordSource = U._coordSource || 'gps';
    U.isClockedIn = true;
  } else {
    U.clockOut = ts; U.clockOutCoords = coords; U.clockOutLoc = loc;
    U.clockOutCoordSource = U._coordSource || 'gps';
  }
  U.lastActionDate = ts;
  save();

  g(inputId).value = '';
  showErrIf(errId, false);
  renderPunchDisplay();

  toast(kind === 'in' ? 'Clock-in recorded.' : 'Clock-out recorded.', 'ok');
}

/* ══════════════════════════════════════════════════════════════
   NEXT-DAY CATCH-UP — v10

   A shift from a previous day that was never submitted is held under
   KEY_PENDING. On the next open we show a read-only prompt with the
   last recorded times (blank where a punch is missing). The user can
   submit it or discard it. They cannot edit a previous day's punches.
*/

/** freshDay — builds a clean same-identity state for a new day */
function freshDay(src) {
  src = src || {};
  return {
    name: src.name || '', id: src.id || '', photo: src.photo || '',
    businessName: src.businessName || '', businessUnit: src.businessUnit || '',
    businessDesc: src.businessDesc || '', buUnitDesc: src.buUnitDesc || '',
    clockIn: null,  clockInCoords: '',  clockInLoc: '',
    clockOut: null, clockOutCoords: '', clockOutLoc: '',
    isClockedIn: false, submitted: false, lastActionDate: nowISO(),
    clockInCoordSource: 'gps', clockOutCoordSource: 'gps',
    _azureEmail: src._azureEmail || ''
  };
}

function loadPending() {
  try { const r = localStorage.getItem(KEY_PENDING); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function clearPending() { localStorage.removeItem(KEY_PENDING); }

/** checkPending — called at end of renderMain; raises the prompt if needed */
function checkPending() {
  const p = loadPending();
  if (!p) return;
  if (g('modal-ov')?.classList.contains('open')) return;  /* don't stack */
  showNextDayPrompt(p);
}

/** showNextDayPrompt — read-only summary of the held shift */
function showNextDayPrompt(p) {
  const dt   = p.lastActionDate ? new Date(p.lastActionDate) : new Date();
  const dstr = dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const inT  = p.clockIn  ? fmt(p.clockIn)  : 'blank';
  const outT = p.clockOut ? fmt(p.clockOut) : 'blank';

  showModal({
    icon: '🕛',
    title: 'Submit your last shift',
    body: `These are your last recorded times for ${dstr} — Clock in: ${inT}, Clock out: ${outT}. Please submit, or this data will not be saved.`,
    buttons: [
      { label: 'Submit now',   cls: 'btn-grn',  fn: () => submitPending(p) },
      { label: "Don't submit", cls: 'btn-edit', fn: () => { clearPending(); toast('Last shift discarded.'); } }
    ]
  });
}

/** submitPending — sends the held shift to the DB; keeps it on failure */
async function submitPending(p) {
  toast('Submitting your last shift…');
  try {
    const { error } = await _db.from('attendance').insert([buildPayload(p)]);
    if (!error) {
      clearPending();
      toast('Last shift submitted.', 'ok');
    } else {
      console.error('[Seamex] Pending submit error:', error);
      toast('Could not submit. You will be asked again next time.', 'err');
    }
  } catch (e) {
    console.error('[Seamex] Pending submit network error:', e);
    toast('Network issue. You will be asked again next time.', 'err');
  }
}

/**
 * buildPayload — single source of truth for the DB record.
 * Missing punches are sent as null (blank). Status is 'completed'
 * only when both punches exist, otherwise 'partial'.
 */
function buildPayload(rec) {
  return {
    user_name:               sanitize(rec.name || ''),
    employee_id:             (rec.id || '').replace(/\D/g, ''),
    clock_in_time:           rec.clockIn  || null,
    clock_in_coords:         rec.clockInCoords  || null,
    clock_in_location_name:  rec.clockInLoc  ? sanitize(rec.clockInLoc)  : null,
    clock_out_time:          rec.clockOut || null,
    clock_out_coords:        rec.clockOutCoords || null,
    clock_out_location_name: rec.clockOutLoc ? sanitize(rec.clockOutLoc) : null,
    status:                  (rec.clockIn && rec.clockOut) ? 'completed' : 'partial',
    business_name:           sanitize(rec.businessName || ''),
    business_unit:           sanitize(rec.businessUnit || ''),
    business_desc:           sanitize(rec.businessDesc || ''),
    bu_unit_desc:            sanitize(rec.buUnitDesc   || ''),
    clock_in_coord_source:   rec.clockInCoordSource  || 'gps',
    clock_out_coord_source:  rec.clockOutCoordSource || 'gps'
  };
}


/* ══════════════════════════════════════════════════════════════
   MODAL SYSTEM — Prasidha
   Generic modal. All content via textContent (XSS safe).
   Buttons built with createElement.
*/

/**
 * showModal — Prasidha
 * @param {object} opts  { icon, title, body, buttons[], showEditIn }
 * buttons: [{ label, cls, fn }]
 */
function showModal({ icon, title, body, buttons, showEditIn = false }) {
  setTx('m-icon',  icon  || 'ℹ️');
  setTx('m-title', title || '');
  setTx('m-body',  body  || '');

  if (showEditIn) {
    show('m-edit-in');
    const inp = g('edit-in-inp');
    if (inp) { inp.value = U.clockInLoc; setTimeout(() => inp.focus(), 200); }
  } else {
    hide('m-edit-in');
  }

  const btnsEl = g('m-btns');
  btnsEl.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn-full ${b.cls || 'btn-red'}`;
    btn.style.cssText = 'margin:0;flex:1';
    btn.textContent = b.label; /* SECURITY: textContent (Prasidha) */
    btn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); if (b.fn) b.fn(); });
    btnsEl.appendChild(btn);
  });

  g('modal-ov').classList.add('open');
}

/** closeModal — Prasidha */
function closeModal() { g('modal-ov').classList.remove('open'); }

g('modal-ov').addEventListener('click', e => { e.preventDefault();
  if (e.target === g('modal-ov')) closeModal();
});

/* (v10) Review / Fix-clock-in / Redo-clock-out removed.
   Corrections are now handled by re-tapping Record now, which
   shows an override confirm and overwrites the punch in place. */

/* ══════════════════════════════════════════════════════════════
   SUBMIT DAY
   Prasidha: isSubmitting guards against double-submit.
   Final sanitize() pass before DB write (defence-in-depth).
   SECURITY: raw Supabase error never shown to user.
*/
g('btn-submit').addEventListener('click', async (e) => { e.preventDefault();
  if (isSubmitting) return;

  /* v10: at least one punch required; missing punch is sent blank */
  if (!U.clockIn && !U.clockOut) {
    toast('Record a clock-in or clock-out first.', 'err');
    return;
  }

  /* Confirm when one side is missing — the blank cannot be added later */
  if (!U.clockIn || !U.clockOut) {
    const missing = U.clockIn ? 'clock-out' : 'clock-in';
    showModal({
      icon: '⚠️', title: 'Submit with a missing punch?',
      body: `Your ${missing} is blank and will be submitted empty. You cannot add it after submitting. Continue?`,
      buttons: [
        { label: 'Submit anyway', cls: 'btn-grn',  fn: () => doSubmit() },
        { label: 'Go back',       cls: 'btn-edit', fn: null }
      ]
    });
    return;
  }
  doSubmit();
});

/** doSubmit — writes the current day's record to the DB */
async function doSubmit() {
  if (isSubmitting) return;
  isSubmitting = true;

  const btn = g('btn-submit');
  btn.disabled = true; btn.textContent = 'Submitting…';
  setTx('ghost-note', "Almost there — submitting your day's work…");
  show('ghost-scr');

  try {
    const { error } = await _db.from('attendance').insert([buildPayload(U)]);
    hide('ghost-scr');

    if (!error) {
      U.submitted = true; save();
      clearPending();   /* this device's day is now safely in the DB */
      pageTransition(() => renderSuccess(), 'Shift submitted!');
      toast('All done! See you tomorrow.', 'ok');
    } else {
      console.error('[Seamex] Supabase error:', error);
      toast('Submission failed. Please try again.', 'err');
      isSubmitting = false;
      btn.disabled = false; btn.textContent = 'Submit shift ✓';
    }
  } catch (e) {
    hide('ghost-scr');
    console.error('[Seamex] Network error:', e);
    toast('Connection issue. Check network and retry.', 'err');
    isSubmitting = false;
    btn.disabled = false; btn.textContent = 'Submit shift ✓';
  }
}

/* ══════════════════════════════════════════════════════════════
   RENDER SUCCESS — Prasidha
   Visible all day. Stops rAF loop (clock not needed on success).
*/
function renderSuccess() {
  stopMainLoop();
  ['ci-grp','co-grp','btn-submit','save-note','ghost-scr','status-card'].forEach(hide);
  const today = new Date();
  setTx('ss-in-t',  U.clockIn  ? fmt(U.clockIn)  : '— blank —');
  setTx('ss-in-l',  U.clockIn  ? U.clockInLoc    : '');
  setTx('ss-out-t', U.clockOut ? fmt(U.clockOut) : '— blank —');
  setTx('ss-out-l', U.clockOut ? U.clockOutLoc   : '');
  setTx('ss-dur',   (U.clockIn && U.clockOut) ? duration(U.clockIn, U.clockOut) : '--:--:--');
  setTx('ss-date',  today.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }));
  show('suc-card');
}

/* ══════════════════════════════════════════════════════════════
   STUCK BUTTON DETECTOR + RECOVERY — FIX-06 (Prasidha)

   markBusy(): call when a GPS-dependent button is disabled.
   After 5s, the recovery button (↺) appears next to theme toggle
   with a spinning animation and a tooltip.

   clearBusy(): called in every finally block after GPS resolves.
   Hides the recovery button and stops the spin.

   recoverState(): DOM-only re-render. URL unchanged. Session kept.
   Resets all stuck buttons and re-renders from current U state.
*/

/** markBusy — Prasidha: starts 5s timer for stuck-button detection */
function markBusy() {
  clearBusy();
  stuckTimer = setTimeout(() => {
    document.querySelectorAll('.rcv-btn').forEach(b => {
      b.classList.remove('hidden');
      b.classList.add('rcv-spin');
    });
    document.querySelectorAll('.rcv-tip').forEach(t => {
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 3500);
    });
  }, 5000);
}

/** clearBusy — Prasidha: cancels stuck timer and hides recovery button */
function clearBusy() {
  if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
  document.querySelectorAll('.rcv-btn').forEach(b => {
    b.classList.add('hidden');
    b.classList.remove('rcv-spin');
  });
  document.querySelectorAll('.rcv-tip').forEach(t => t.classList.add('hidden'));
}

/**
 * recoverState — Prasidha (FIX-06)
 * DOM-only recovery. Re-renders from U. URL unchanged. Session kept.
 * Called by the ↺ recovery button in both footers.
 */
function recoverState() {
  clearBusy();
  closeModal();

  /* Reset all potentially stuck buttons */
  [
    { id: 'btn-start',  txt: 'Start Day'      },
    { id: 'btn-ci',     txt: 'Record now'     },
    { id: 'btn-co',     txt: 'Record now'     },
    { id: 'btn-submit', txt: 'Submit shift ✓' }
  ].forEach(({ id, txt }) => {
    const b = g(id);
    if (b) { b.disabled = false; b.textContent = txt; }
  });

  hide('ghost-scr');
  hide('inline-loader');
  const sb = g('btn-start');
  if (sb) sb.classList.remove('hidden');

  /* Re-render the correct view from U state */
  if (!g('main-sec') || g('main-sec').classList.contains('hidden')) {
    /* Stuck on auth — just re-enable the form */
    setupLoginValidation();
  } else if (U.submitted) {
    renderSuccess();
  } else {
    /* Stuck on main — re-render both punch blocks from U */
    hide('suc-card');
    renderMain();
  }

  toast('Page recovered. ↺', 'ok');
}

/* ══════════════════════════════════════════════════════════════
   GPS — getCoords()
   ★ FIX-05 (Prasidha) — TRUE Promise.race ★

   Two completely separate Promises:
     geoPromise    : resolves via getCurrentPosition callback.
     safetyPromise : resolves null after 9s guaranteed.
   Promise.race returns whichever settles first.

   This is different from the v06 approach which had ONE Promise
   with an internal timer — the timer could be bypassed in edge
   cases on iOS WebKit where the geo callback neither fires
   success nor error, leaving the function awaiting indefinitely.

   With Promise.race, the maximum wait is always 9s.
   Combined with the `finally` block in btn-co and btn-ci,
   the button is guaranteed to re-enable in under 9 seconds.
*/
/* ══════════════════════════════════════════════════════════════
   LOCATION SYSTEM — Prasidha (v08 — Android WebView permanent fix)

   ROOT CAUSE SUMMARY:
   Android WebView is a separate permission sandbox from the host app.
   Even when the Flutter app has OS location permission granted,
   the WebView does NOT inherit it unless the Flutter developer
   explicitly handles onGeolocationPermissionsShowPrompt.
   iOS WKWebView inherits permission automatically — that is why
   iOS works and Android does not. This is an Android OS security
   boundary that cannot be bypassed from JavaScript.

   FLUTTER HOST APP FIX (permanent — share with app developer):
   ─────────────────────────────────────────────────────────────
   In the InAppWebView widget, add this callback:

     InAppWebView(
       initialSettings: InAppWebViewSettings(
         geolocationEnabled: true,
       ),
       onGeolocationPermissionsShowPrompt: (controller, origin) async {
         return GeolocationPermissionShowPromptResponse(
           origin: origin,
           allow: true,
           retain: true,
         );
       },
     )

   If the app uses webview_flutter instead of flutter_inappwebview,
   webview_flutter does NOT expose this callback at all on Android.
   The app MUST switch to flutter_inappwebview package.

   WEB-SIDE SOLUTION (this file — no host app change needed):
   ─────────────────────────────────────────────────────────────
   When navigator.geolocation fails inside Android WebView,
   fall back to IP-based geolocation via BigDataCloud free API.
   No API key required. No permission required. Works in any
   WebView, any container, any platform — it is just an HTTPS fetch.

   Accuracy tradeoff:
     GPS (navigator.geolocation): 5-10 metres
     IP geolocation (fallback):   1-5 km (city/area level)

   For attendance verification (confirming employee is at the
   right site/city), this is sufficient. The coord_source field
   in the DB record tells HR which method was used.

   MIGRATION NOTE (Prasidha):
   Add coord_source column to attendance table in Supabase:
     ALTER TABLE attendance ADD COLUMN coord_source text DEFAULT 'gps';
   This lets HR filter records by location method in the admin panel.
*/

/**
 * getIPCoords — Prasidha
 * Fetches approximate coordinates from BigDataCloud IP geolocation API.
 * No API key, no permission, works in every WebView and container.
 * Returns "lat,lng" string or null on network failure.
 * Same API used in the Seamex weather widget project.
 * @returns {Promise<string|null>}
 */
async function getIPCoords() {
  try {
    const res = await fetch(
      'https://api.bigdatacloud.net/data/ip-geolocation?localityLanguage=en',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const lat = data?.location?.latitude;
    const lng = data?.location?.longitude;
    if (!lat || !lng) return null;
    return `${parseFloat(lat).toFixed(6)},${parseFloat(lng).toFixed(6)}`;
  } catch {
    return null;
  }
}

/**
 * getCoords — Prasidha (v08 — definitive GPS + IP fallback)
 *
 * Strategy:
 *   1. Try navigator.geolocation (GPS) — works on iOS, Chrome, and
 *      Android WebView once host app is fixed.
 *   2. If GPS fails (any reason), silently fall back to IP geolocation.
 *      User sees no error — attendance is recorded with city accuracy.
 *   3. If both fail (no internet), show error toast.
 *
 * The fallback is silent by design. Field employees should not be
 * blocked from clocking in due to a host app configuration issue.
 * HR can distinguish GPS vs IP records via the coord_source field.
 *
 * @returns {Promise<string|null>} "lat,lng" string or null
 */
async function getCoords() {
  /* ── Step 1: Native GPS — keep the most accurate reading ────
     watchPosition streams fixes; GPS accuracy improves over the
     first few seconds. We keep the smallest-accuracy fix, settle
     early once it is good (≤ 20 m), and always settle by 7 s.
     A hard 16 s race ceiling guarantees the button re-enables.   */
  const gpsCoords = await Promise.race([
    new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }

      let best = null, watchId = null, settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (_) {} }
        resolve(best ? `${best.lat.toFixed(6)},${best.lng.toFixed(6)}` : null);
      };

      try {
        watchId = navigator.geolocation.watchPosition(
          pos => {
            const acc = pos.coords.accuracy || 99999;
            if (!best || acc < best.acc) {
              best = { acc, lat: pos.coords.latitude, lng: pos.coords.longitude };
            }
            if (acc <= 20) finish();   /* good enough — stop early */
          },
          () => finish(),              /* error → settle with best-so-far (may be null) */
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
        /* Collect for up to 7s, then take the best fix we have */
        setTimeout(finish, 7000);
      } catch (_) { finish(); }
    }),
    new Promise(r => setTimeout(() => r(null), 16000))  /* absolute ceiling */
  ]);

  if (gpsCoords) {
    U._coordSource = 'gps';
    return gpsCoords;
  }

  /* ── Step 2: IP geolocation fallback (silent, approximate) ─── */
  toast('GPS unavailable. Using network location…', '');
  const ipCoords = await getIPCoords();

  if (ipCoords) {
    U._coordSource = 'ip';
    return ipCoords;
  }

  /* ── Step 3: Both failed — genuine connectivity issue ─────── */
  toast('Location unavailable. Please check your internet connection.', 'err');
  U._coordSource = null;
  return null;
}


/* ══════════════════════════════════════════════════════════════
   LOCATION CACHE
   Prasidha: localStorage cache for autocomplete and chips.
   SECURITY: entries sanitized on write. textContent on all renders.
   MIGRATION: swap localStorage with sessionStorage or userProfile
   service when moving to SharePoint SPFx.
*/

/** getCached — Prasidha: returns cached location array */
function getCached() {
  try { return JSON.parse(localStorage.getItem(KEY_LOCS) || '[]'); }
  catch { return []; }
}

/** saveLoc — Prasidha: prepends location, deduplicates, trims to MAX_LOCS */
function saveLoc(loc) {
  if (!loc) return;
  let list = getCached().filter(l => l.toLowerCase() !== loc.toLowerCase());
  list.unshift(loc);
  localStorage.setItem(KEY_LOCS, JSON.stringify(list.slice(0, MAX_LOCS)));
}

/**
 * renderChips — Prasidha
 * Renders last 3 locations as quick-select pill buttons.
 * SECURITY: textContent on all chip text — XSS safe.
 */
function renderChips(inputId, chipsId, dropId) {
  const locs = getCached().slice(0, 3);
  const wrap = g(chipsId); if (!wrap) return;
  wrap.innerHTML = '';
  locs.forEach(loc => {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'chip'; c.title = loc;
    c.textContent = '📍 ' + loc; /* SECURITY: textContent (Prasidha) */
    c.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = g(inputId); if (inp) inp.value = loc;
      const drop = g(dropId); if (drop) drop.classList.remove('open');
    });
    wrap.appendChild(c);
  });
}

/**
 * setupAC — Prasidha
 * Sets up autocomplete for one input/dropdown pair.
 * MUST be called only once per input at DOMContentLoaded.
 * Multiple calls stack document.click listeners — memory leak.
 */
function setupAC(inputId, dropId, chipsId) {
  const input = g(inputId), drop = g(dropId);
  if (!input || !drop) return;
  input.addEventListener('focus', () => {
    renderChips(inputId, chipsId, dropId);
    renderDrop(inputId, dropId);
  });
  input.addEventListener('input', () => renderDrop(inputId, dropId));
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !drop.contains(e.target))
      drop.classList.remove('open');
  });
}

/**
 * renderDrop — Prasidha
 * Populates autocomplete dropdown. Max 5 suggestions.
 * SECURITY: all items via createElement/textContent — XSS safe.
 */
function renderDrop(inputId, dropId) {
  const q    = g(inputId)?.value.toLowerCase().trim();
  const drop = g(dropId); if (!drop) return;
  const hits = (q
    ? getCached().filter(l => l.toLowerCase().includes(q))
    : getCached()
  ).slice(0, 5);

  if (!hits.length) { drop.classList.remove('open'); return; }
  drop.innerHTML = '';
  hits.forEach(loc => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    const ico = document.createElement('span'); ico.textContent = '📍';
    const txt = document.createElement('span'); txt.textContent = loc;
    item.append(ico, txt);
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = g(inputId); if (inp) inp.value = loc;
      drop.classList.remove('open');
    });
    drop.appendChild(item);
  });
  drop.classList.add('open');
}

/* ══════════════════════════════════════════════════════════════
   TOAST — Prasidha
   Centered blur-backdrop overlay. 1.5s auto-dismiss.
   SECURITY: msg via textContent — never innerHTML.
*/
let _toastTimer = null;

/**
 * toast — Prasidha
 * @param {string} msg - Message text
 * @param {'ok'|'err'|''} type - Colour variant
 */
function toast(msg, type = '') {
  const ov   = g('toast-ov');
  const pill = g('toast-pill');
  if (!ov || !pill) return;

  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

  pill.textContent = msg; /* SECURITY: textContent (Prasidha) */
  pill.className = 'toast-pill' + (type ? ' ' + type : '');

  ov.classList.remove('hidden', 'to-out');

  _toastTimer = setTimeout(() => {
    ov.classList.add('to-out');
    setTimeout(() => {
      ov.classList.add('hidden');
      ov.classList.remove('to-out');
    }, 280);
  }, 1500);
}

/* ══════════════════════════════════════════════════════════════
   HELPERS — see top of file for hoisted function declarations
*/

/**
 * isNewDay — Prasidha
 * True if lastDate was on a previous calendar day.
 * Drives the midnight session reset.
 */
function isNewDay(lastDate) {
  if (!lastDate) return false;
  return new Date(lastDate).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
}

/**
 * fmt — Prasidha
 * Formats ISO timestamp as HH:MM AM/PM (en-IN locale).
 */
function fmt(iso) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/**
 * msDur — Prasidha
 * Converts milliseconds to HH:MM:SS string.
 * Used by rAF loop for live timer and duration() for frozen display.
 */
function msDur(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '00:00:00';
  return [
    Math.floor(ms / 3600000),
    Math.floor((ms % 3600000) / 60000),
    Math.floor((ms % 60000) / 1000)
  ].map(n => n.toString().padStart(2, '0')).join(':');
}

/**
 * duration — Prasidha
 * Computes and formats duration between two ISO timestamps.
 */
function duration(inISO, outISO) {
  if (!inISO || !outISO) return '--';
  return msDur(new Date(outISO) - new Date(inISO));
}

/*
 * ══════════════════════════════════════════════════════════════
 *  Prasidha Jagtap | IT · Aditya Birla Group (Seamex)
 *  Geo Attendance v07 — Definitive Golden Build
 *  Built for field teams. Maintained with care and intent.
 *  If you are reading this: keep the standards. 🚀
 * ══════════════════════════════════════════════════════════════
 */