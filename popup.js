// popup.js

const content = document.getElementById("main-content");

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isLinkedInJobs(url) {
  return url && url.includes("linkedin.com/jobs");
}

async function render() {
  const tab = await getCurrentTab();
  const { apiKey } = await chrome.storage.local.get("apiKey");

  if (!isLinkedInJobs(tab.url)) {
    content.innerHTML = `
      <div class="not-linkedin">
        <div class="icon">💼</div>
        <p>Navigate to <a href="https://www.linkedin.com/jobs/" target="_blank">LinkedIn Jobs</a> and search for a role to get started.</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="api-section">
      <label>Anthropic API Key</label>
      <div class="api-input-row">
        <input type="password" id="api-key-input" placeholder="sk-ant-..." value="${apiKey || ""}" />
        <button class="save-btn" id="save-key-btn">Save</button>
      </div>
      <div class="api-hint">
        Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>
      </div>
      <span class="saved-indicator" id="saved-indicator">✓ Saved!</span>
    </div>

    <div class="divider"></div>

    <div class="status-section">
      <div class="status-badge">
        <div class="status-dot ${apiKey ? "active" : "warning"}" id="status-dot"></div>
        <span id="status-text">${apiKey ? "Ready to scan" : "API key required"}</span>
      </div>
    </div>

    <button class="scan-btn" id="scan-btn" ${!apiKey ? "disabled" : ""}>
      ⚡ Scan Jobs on This Page
    </button>

    <button class="toggle-btn" id="toggle-btn">
      ☰ Toggle Sidebar
    </button>

    <button class="toggle-btn" id="debug-btn" style="margin-top:4px;font-size:11px;color:#475569">
      🔍 Debug Page
    </button>

    <div id="debug-output" style="display:none;margin-top:8px;padding:10px;background:#0d0d14;border:1px solid #1e1e2e;border-radius:8px;font-size:10px;color:#64748b;word-break:break-all;line-height:1.7;max-height:220px;overflow-y:auto"></div>
  `;

  document.getElementById("save-key-btn").addEventListener("click", async () => {
    const key = document.getElementById("api-key-input").value.trim();
    if (!key) return;
    await chrome.storage.local.set({ apiKey: key });
    const indicator = document.getElementById("saved-indicator");
    indicator.style.display = "inline";
    setTimeout(() => indicator.style.display = "none", 2000);
    document.getElementById("status-dot").className = "status-dot active";
    document.getElementById("status-text").textContent = "Ready to scan";
    document.getElementById("scan-btn").disabled = false;
  });

  document.getElementById("scan-btn").addEventListener("click", async () => {
    const { apiKey: storedKey } = await chrome.storage.local.get("apiKey");
    if (!storedKey) return;
    document.getElementById("scan-btn").disabled = true;
    document.getElementById("scan-btn").textContent = "Scanning...";
    await chrome.tabs.sendMessage(tab.id, { type: "START_SCAN", apiKey: storedKey });
    window.close();
  });

  document.getElementById("toggle-btn").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
    window.close();
  });

  document.getElementById("debug-btn").addEventListener("click", async () => {
    const debugOut = document.getElementById("debug-output");
    debugOut.style.display = "block";
    debugOut.textContent = "Inspecting page...";
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "DEBUG_PAGE" });
      const d = response.html;
      debugOut.innerHTML = `
        <b style="color:#94a3b8">🔍 Page Debug</b><br>
        <br>
        <b style="color:#6366f1">Biggest list:</b> ${d.biggestListCount} items<br>
        List class: <code>${escHtml(d.biggestListClass)}</code><br>
        First child class: <code>${escHtml(d.biggestListFirstChildClass)}</code><br>
        Sample text: <i>${escHtml(d.biggestListSample.slice(0, 150))}</i><br>
        <br>
        <b style="color:#6366f1">Job-related classes found:</b><br>
        ${escHtml(d.jobRelatedClasses.slice(0, 300))}
      `;
    } catch (e) {
      debugOut.textContent = "Error: " + e.message + "\n\nRefresh the LinkedIn page then try again.";
    }
  });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

render();
