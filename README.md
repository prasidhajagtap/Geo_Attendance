# Seamex · Geo-Attendance · Project Handover

**Project name:** Seamex Geo-Attendance
**Creator & Owner:** Prasidha Jagtap, Assistant Manager — IT, Aditya Birla Group (Seamex)
**Location:** Reliable Tech Park, Airoli, Maharashtra, India
**Poornata ID:** 446686
**Status:** Active development — UAT deployment on SharePoint 2019 on-prem
**Current version:** v15 (Seamex-GeoAttendance-v15-standalone.html)

---

## 1. What this app does

A mobile-first geo-attendance web app embedded in the OneHRPortal SharePoint site, run inside a Flutter WebView on Android (and Chrome on laptops for testing). It lets employees:

1. Sign in automatically via SharePoint's Azure ADFS SSO (no password prompt — identity comes from hidden SharePoint fields)
2. Clock in or clock out with their GPS location captured
3. Name the location they're at (free-text label)
4. Submit the day's shift to a Supabase backend at end of day, or have it auto-prompted the next day if unsubmitted

The app is mobile-only by design. It's used by non-technical employees, so every UX decision favours simplicity, large tap targets, and clear language.

---

## 2. Stack & architecture

- **Frontend:** Single self-contained HTML file (inline CSS + JS). No build step, no framework.
- **Fonts:** DM Sans + DM Mono via Google Fonts CDN
- **Identity provider:** SharePoint Azure ADFS — hidden fields injected into the page master:
  - `ctl00_ctl53_hdnName`
  - `ctl00_ctl53_hdnPoornataId`
  - `ctl00_ctl53_hdnPictureUrl`
  - `ctl00_ctl53_hdnCurrentUserEmail`
  - `ctl00_ctl53_hdnBusinessName`, `hdnBusinessUnit`, `hdnBusinessDesc`, `hdnBuUnitDesc`
- **Backend:** Supabase (PostgreSQL + auto-generated REST). URL: `svhbqvcabbzrxvndxtjm.supabase.co`. Tier: free (auto-pauses after ~7 days inactivity — needs a keep-alive ping for go-live).
- **Geolocation:** browser `navigator.geolocation.watchPosition` with IP-fallback (BigDataCloud) when GPS is blocked. Accuracy classified as Accurate (≤50m) / Approximate (50–500m) / Network only (>500m or IP fallback).
- **Hosting:** Content Editor / Script Editor Web Part on the SharePoint page `Pages/AzureloginNew.aspx`.

---

## 3. File deployment

**Single file:** `Seamex-GeoAttendance-v15-standalone.html`

Deploy by pasting the **entire file contents** into the Content Editor / Script Editor Web Part on `Pages/AzureloginNew.aspx`. Check in + publish the page. The inline approach is critical — earlier deployments via external `/Style Library/GeoTagg_new/script.js + style.css` failed because SharePoint's BLOB cache and file-publishing served them stale, ignoring `?v=` query strings. Inline HTML in the web part updates instantly.

The only external dependencies are the **Supabase library** (via cdn.jsdelivr.net) and **Google Fonts** (via fonts.googleapis.com) — these are on their own CDNs, untouched by SharePoint's cache.

---

## 4. Screen flow

```
[ Auth fallback ] <-- shown only if Azure detection fails
        |
        v
[ Welcome screen ] <-- centered logo + photo + name + PID + two big action buttons
        |
        v (user taps Clock in or Clock out)
[ Capture window ] <-- GPS captured automatically; user names the location; confirms
        |
        v
[ Main screen ] <-- side-by-side header (logo+clock left, photo+PID right);
                    hero status block (one of 4 states); two tiles with edit icons;
                    tap-and-hold submit
        |
        v (tap-and-hold for 1 second on Submit)
[ Submitted page ] <-- centered: logo, photo+name+PID, green tick, "Shift submitted",
                       date, full shift details card with clock in/out/duration
```

The welcome screen is shown only **before the first punch of a day**. Once a user clocks in or out, they go directly to the main screen on next open.

---

## 5. Locked logic — the hero status block (main screen)

The hero block on the main screen shows one of four states. **There is no separate timer element** — this single block adapts to what's recorded:

| State                    | Trigger                              | Hero label       | Hero value                        | Sub-text                                                                       |
|--------------------------|--------------------------------------|------------------|-----------------------------------|--------------------------------------------------------------------------------|
| `empty`                  | No punches yet                       | Not started      | `00:00:00`                        | (blank)                                                                        |
| `ci-only`                | Clock-in only                        | Current shift    | **running timer** HH:MM:SS        | `Since <CI time> · Clock out awaiting`                                         |
| `co-only`                | Clock-out only                       | Clocked out      | CO time (static)                  | `No clock-in recorded today`                                                   |
| `duration`               | Both CI and CO, CI < CO              | Shift duration   | duration HH:MM:SS (static)        | `<CI time> → <CO time>`                                                        |
| `warning`                | Both CI and CO, CI > CO              | Needs review     | Warning text (amber background)   | (blank) — text reads "Clock-in is after clock-out. Tap Clock out again or Submit to keep as-is." |

The CI-only state is the only one that ticks every second. All others are static.

---

## 6. Locked logic — edit flow

When a tile (clock-in or clock-out) has a recorded value, a small pencil icon appears top-right. Tapping it opens a **mobile-native bottom sheet** with three options:

1. **Mark time now** — updates the time to the current moment (with a live clock shown in the confirm popup, updating every second so the user sees exactly what time they're committing to). Location coordinates and label are unchanged.
2. **Rename location** — opens a text input; lets the user edit the location label only. GPS coordinates stay the same.
3. **New place** — full re-capture: GPS + label.

Each option shows a one-line confirm explaining exactly what will change before the action commits. The bottom sheet has a Cancel button at the bottom.

Empty tiles (no time recorded yet) have no edit icon — the whole tile acts as a tap target for the first capture.

---

## 7. Locked logic — submit flow

- **Submit button:** circular tap-and-hold. User holds for 1 second; ring fills with orange-to-red gradient; on completion ring goes green with a tick and the submit fires. If user releases early, ring retracts.
- **Missing punch behaviour (v15):** soft nudge only, not a block. If user submits with one punch missing, a toast appears: *"Heads up: your clock-out is missing. Submitting as-is."* Then the submit proceeds. The shift goes into Supabase with `status: 'partial'` and the missing field as `null`. Submitting with **both** punches empty is blocked (toast: *"Please record at least a clock-in or clock-out first."*).
- **Out-of-order times (CI > CO):** the hero block shows the warning state. User can either re-tap Clock out to overwrite, or proceed to submit anyway. Payload includes `out_of_order: true` flag.
- **Next-day catch-up:** if a shift is left unsubmitted at end of day, on opening the app on a new day, a read-only prompt offers the user to submit the previous day's recorded times. Pending shift is held in localStorage key `smx_pending`.

---

## 8. Visual spec — brand & themes

- **Colours (light):** orange `#F58220`, red `#A6192E`, yellow `#FFCB05`
- **Colours (dark):** brighter orange `#FF9A40`, brighter red `#E0364B`, yellow `#FFD442`
- **Surfaces (light):** card `#ffffff`, bg `#f4f1ea`, surface `#f0ede5`
- **Surfaces (dark):** card `#1f2330`, bg `#161922`, surface `#272b38`
- **Fonts:** DM Sans (UI), DM Mono (times, IDs, dates)
- **Dark mode treatment:** Option B — neutral surfaces with brand colours used only as accents (left borders on tiles, icon tints, submit gradient). Subtle glow on Seamex logo, header clock, hero value.
- **Logo:** rendered as gradient text (not an image) so it always paints, no load dependency.

---

## 9. CSS isolation strategy (v15)

The app runs inside SharePoint 2019 on-prem, which injects `corev15.css` with class+element `!important` rules that bleed into the app. The fix:

1. **All classes prefixed `smx-`** so they cannot collide with any SP class (which use `.ms-*`, `.s4-*`, etc.).
2. **High-specificity selectors:** every critical rule uses `main#smx-root element.smx-class` — ID + element + class specificity beats any class-only SP rule even when SP uses `!important`.
3. **Single self-contained file:** no external CSS/JS that SP's BLOB cache can serve stale.

---

## 10. Testing approach

Each new version is validated with a **Node.js DOM harness** that stubs `document`, `localStorage`, `navigator.geolocation`, `supabase`, and the SharePoint hidden fields, then executes the app's full init path. The harness verifies:

- Boot → identity resolved → welcome screen shown
- Welcome → capture → main, with running shift timer ticking
- Clock-out → duration state shown
- Edit → Mark time now (live clock visible in confirm)
- Edit → Rename location
- Hero warning state (CI > CO)
- Hero CO-only state
- Tap-and-hold submit triggers commit
- Success page renders with identity + shift details

The harness is run before every shipped file. Bugs caught in static checks: missing IDs, JS syntax errors, duplicate function definitions, broken section routing.

---

## 11. Version history

- **v09** — original linear flow (CI → CO → review → submit). Working baseline on SharePoint.
- **v10** — clock-logic redesign (free-will ordering, override prompts).
- **v11** — multi-screen flow (welcome / capture / main / submitted). Animated transitions.
- **v12** — side-by-side main header, edit flow, tap-and-hold submit, accuracy dot, "no running counter" interim rules.
- **v13** — full `smx-` class prefix, defensive root reset.
- **v14** — iframe isolation attempt. **Failed** (infinite scroll loop, JSON encoding broke rendering). Abandoned.
- **v15** — current. Back to single file. CI-only running timer restored. High-specificity `main#smx-root` selectors. Live clock in Mark time popup. Soft nudge on missing punch.

---

## 12. Known issues / pending

- **Android WebView GPS:** the Flutter WebView container does not forward HTML5 geolocation permissions to the page. Web side falls back to IP location. Fix is on the Flutter dev-team side (AndroidManifest `ACCESS_FINE_LOCATION`, runtime permission, `onGeolocationPermissionsShowPrompt` callback forwarding, iOS `NSLocationWhenInUseUsageDescription`). User testing on iOS in the meantime.
- **Supabase auto-pause:** free-tier projects pause after ~7 days inactivity. Needs a daily keep-alive ping before go-live.
- **Auth fallback screen polish:** card height not fully using device viewport; button styling needs to match the main brand buttons.

---

## 13. Enhancement backlog

- Retry submit button + offline indicator
- Daily keep-alive ping to Supabase
- Accuracy radius warning (visible threshold)
- "My recent shifts" history view
- Export shift summary (PDF or share sheet)
- Dashboard sync — mirror new fields/statuses into the admin dashboard
- iOS-specific tweaks once Flutter team forwards location

---

## 14. Working agreement (for any AI continuing this project)

The owner has set these rules — follow them:

1. **Ask before building.** Interviewer-style questions; one focused question at a time; offer 2–3 options with a recommendation.
2. **Don't just agree.** If the owner's request has a flaw, point it out. Recommend the right path even if it contradicts the brief.
3. **Mockups before code.** Show the visual change in a separate mockup HTML before touching the working file.
4. **No iterations.** Build once, test thoroughly, ship a single file. Re-iterating wastes the owner's time.
5. **Test with the Node harness** before delivering. Static checks (syntax, ID resolution, duplicate definitions) and DOM execution checks (boot, flows, success).
6. **Single file delivery.** SharePoint's caching makes external assets unreliable. Inline everything.
7. **Respect brand:** Seamex colours only (orange, red, yellow). DM Sans + DM Mono fonts. Mobile-only.
8. **Simple language for non-technical users.** No jargon in UI text. "Stamp time now" → "Mark time now". "GPS accuracy ±8m" → "Accurate / Approximate / Network only".

---

*Document maintained by Prasidha Jagtap. Last updated alongside v15 build.*
