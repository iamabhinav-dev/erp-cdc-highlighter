# ERP Table Row Highlighter — IIT KGP CDC

A browser extension for **Firefox** and **Brave/Chrome** that automatically colour-highlights rows on the IIT Kharagpur ERP **CDC Placement / Internship** portal so you can instantly see which companies you've applied to, which are still open, which are closing soon, and which are expired.

---

## ✨ Features

| Colour | Meaning |
|---|---|
| 🟢 **Soft green** | Applied — your Application Status is `Y` |
| 🔵 **Soft blue** | Can Apply — deadline is open, not yet applied |
| 🔴 **Soft pink (pulsing)** | Urgent — closing within the threshold (default 12 h) |
| ⬜ **Faded / dimmed** | Closed — deadline has passed |

- **Draggable floating bar** — shows live counts (Can Apply / Applied / Urgent / Closed) and one-click filter buttons.  
- **Stays up to date** — rows are re-checked every minute, so they turn urgent / closed as deadlines pass without a reload.  
- **Timezone-safe** — ERP deadlines are read as IST, so the colours are correct even if your computer is set to another timezone.  
- **Works inside the ERP iframe** — the CDC table loads inside `<iframe id="myframe">`, and the extension injects into it automatically via `all_frames: true`.  
- **jqGrid aware** — uses `aria-describedby` attributes to identify the correct columns regardless of column order.  
- **Configurable popup** — click the toolbar icon to toggle highlights, change colours, and set the urgent-hours threshold.  
- **No external requests** — 100 % local, zero telemetry.

---

## 🚀 Installation

### Brave / Chrome / Edge
1. Download or clone this repository.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn **ON** Developer mode (top-right toggle).
4. Click **"Load unpacked"** and select the **`extension/`** folder.
5. *(Optional — for local file testing, see below)* Click **Details → Allow access to file URLs**.

### Firefox

#### 🦊 Official Firefox Add-on (Recommended)
Install directly from the store:
- **Firefox Add-ons Store:** [Install ERP Table Row Highlighter](https://addons.mozilla.org/firefox/addon/erp-table-row-highlighter/)
- **Developer Hub Versions:** [AMO Version Management](https://addons.mozilla.org/en-US/developers/addon/erp-table-row-highlighter/versions)

#### 🛠 Temporary Developer Mode
1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **"Load Temporary Add-on…"**.
4. Navigate to the `extension/` folder and select **`manifest.json`** (or select a packaged `erp-row-highlighter-<version>.xpi`).

---

## 🧪 Testing Locally (without logging into ERP)

The extension only runs on `erp.iitkgp.ac.in`, so to try it on the mock pages:

1. In `extension/manifest.json`, temporarily add `"file:///*"` to `content_scripts[0].matches` (**don't commit this**).
2. Load the extension (steps above). On Brave/Chrome also enable **Allow access to file URLs**.
3. Open `mock_erp_test.html` — it simulates the ERP iframe structure with the same jqGrid markup.
4. You should see coloured / faded rows and the draggable stats bar. The mock deadlines are fixed dates, so edit them in `mock_table.html` to see the *Can Apply* and *Urgent* states.

---

## 📁 Repository Structure

```
extension/
├── manifest.json       # Extension manifest (MV3, Firefox + Chromium)
├── content.js          # Row-highlighting logic (injected into all frames)
├── content.css         # Row colour classes + draggable bar styles
├── popup.html          # Popup UI
├── popup.css           # Popup styles
├── popup.js            # Popup controller
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png

mock_erp_test.html      # Local test page (parent frame)
mock_table.html         # Local test page (inner iframe — jqGrid markup)
```

---

## ⚙️ How It Works

The ERP CDC page (`showmenu.htm`) renders the placement table inside a nested iframe pointing to `TrainingPlacementSSO/TPStudent.jsp`. That page uses **jqGrid** to load data as XML via AJAX after page load.

The extension:
1. Injects `content.js` + `content.css` into **every frame** on `erp.iitkgp.ac.in`.
2. Waits for jqGrid rows (`tr.jqgrow`) to appear via a `MutationObserver` + polling loop.
3. For each row, reads:
   - **Application status** from `td[aria-describedby*="_apply"]`
   - **Deadline** from `td[aria-describedby$="_resumedeadline"]` (the *end* date, never `_resumedeadline_st`)
4. Adds a CSS class (`erp-applied`, `erp-can-apply`, `erp-urgent`, `erp-expired`) to the `<tr>` — nothing inside the row cells is modified.
5. Renders a draggable floating bar with live stats and filter buttons.
6. Re-checks every row once a minute so states follow the clock.

---

## 🛠 Configuration

Click the extension icon in your browser toolbar:

- Toggle each highlight type on/off individually.
- Change highlight colours with the colour picker.
- Set the **Urgent threshold** (hours before deadline that triggers the red alert).
- Toggle the floating stats bar on/off.

---

## 🤝 Contributing

Pull requests and issues are welcome! Tested on:
- Firefox 142+
- Brave 1.70+ / Chrome 120+

---

## 📄 License

MIT — free to use, modify, and distribute.
