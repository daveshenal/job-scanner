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
  `;

  // Save API key
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

  // Scan button
  document.getElementById("scan-btn").addEventListener("click", async () => {
    const { apiKey: storedKey } = await chrome.storage.local.get("apiKey");
    if (!storedKey) return;

    document.getElementById("scan-btn").disabled = true;
    document.getElementById("scan-btn").textContent = "Scanning...";

    await chrome.tabs.sendMessage(tab.id, {
      type: "START_SCAN",
      apiKey: storedKey
    });

    window.close();
  });

  // Toggle sidebar
  document.getElementById("toggle-btn").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
    window.close();
  });
}

render();
