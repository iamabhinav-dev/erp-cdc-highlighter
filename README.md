# ERP Table Row Highlighter — IIT KGP CDC

A browser extension for **Firefox** and **Brave/Chrome** that automatically colour-highlights rows on the IIT Kharagpur ERP **CDC Placement / Internship** portal so you can instantly see which companies you've applied to, which are still open, which are closing soon, and which are expired.

![Extension preview](preview.png)

---

## ✨ Features

| Colour | Meaning |
|---|---|
| 🟢 **Soft green** | Applied — your Application Status is `Y` |
| 🔵 **Soft blue** | Can Apply — deadline is open, not yet applied |
| 🔴 **Soft pink (pulsing)** | Urgent — closing within the threshold (default 12 h) |
| ⬜ **Faded / dimmed** | Closed — deadline has passed |

- **Draggable floating bar** — shows live counts (Can Apply / Applied / Urgent / Closed) and one-click filter buttons.  
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
5. *(Optional — for local file testing)* Click **Details → Allow access to file URLs**.

### Firefox

#### 🦊 Official Firefox Add-on (Recommended)
Install directly from the store:
- **Firefox Add-ons Store:** [Install ERP Table Row Highlighter](https://addons.mozilla.org/firefox/addon/erp-table-row-highlighter/)
- **Developer Hub Versions:** [AMO Version Management](https://addons.mozilla.org/en-US/developers/addon/erp-table-row-highlighter/versions)

#### 🛠 Temporary Developer Mode
1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **"Load Temporary Add-on…"**.
4. Navigate to the `extension/` folder and select **`manifest.json`** (or select `erp-row-highlighter-1.0.4.xpi`).

---

## 🧪 Testing Locally (without logging into ERP)

1. Load the extension (steps above).
2. Open `mock_erp_test.html` in your browser — it simulates the ERP iframe structure with the exact same jqGrid markup.
3. You should see green / blue / pink / faded rows and the draggable stats bar.

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
1. Injects `content.js` + `content.css` into **every frame** on `*.iitkgp.ac.in` (and all URLs for local testing).
2. Waits for jqGrid rows (`tr.jqgrow`) to appear via a `MutationObserver` + polling loop.
3. For each row, reads:
   - **Application status** from `td[aria-describedby$="_apply"]`
   - **Deadline** from `td[aria-describedby$="_resumedeadline"]`
4. Adds a CSS class (`erp-applied`, `erp-can-apply`, `erp-urgent`, `erp-expired`) to the `<tr>` — nothing inside the row cells is modified.
5. Renders a draggable floating bar with live stats and filter buttons.

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
- Firefox 120+
- Brave 1.70+ / Chrome 120+

---

## 📄 License

MIT — free to use, modify, and distribute.
