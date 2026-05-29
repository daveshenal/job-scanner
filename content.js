// content.js
// Selectors discovered by live DOM inspection of LinkedIn (May 2026):
// - Job titles: span._794ff500 (every 2nd one, odd are aria-hidden duplicates)
// - Job card:   span._794ff500 -> closest('div._2f9e3fe1') -> .parentElement.parentElement
// - Card lines: [0] title (may have "Selected, " prefix), [1] title again, [2] company, [3] location
// - Description: first div whose innerText starts with "About the job"

let sidebar = null;
let isScanning = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_SCAN") {
    startScan(message.apiKey);
    sendResponse({ success: true });
  }
  if (message.type === "TOGGLE_SIDEBAR") {
    toggleSidebar();
    sendResponse({ success: true });
  }
});

function toggleSidebar() {
  if (sidebar) sidebar.classList.toggle("ljs-hidden");
}

function createSidebar() {
  if (sidebar) return;
  sidebar = document.createElement("div");
  sidebar.id = "ljs-sidebar";
  sidebar.innerHTML = `
    <div class="ljs-header">
      <div class="ljs-header-left">
        <span class="ljs-logo">⚡</span>
        <span class="ljs-title">Job Scanner</span>
      </div>
      <button class="ljs-close" id="ljs-close-btn">✕</button>
    </div>
    <div class="ljs-body" id="ljs-body"></div>
  `;
  document.body.appendChild(sidebar);
  document.getElementById("ljs-close-btn").addEventListener("click", () => {
    sidebar.classList.add("ljs-hidden");
  });
}

async function startScan(apiKey) {
  if (isScanning) return;
  isScanning = true;

  createSidebar();
  sidebar.classList.remove("ljs-hidden");
  showScanning("Collecting job listings...");

  try {
    const jobs = collectJobs();

    if (jobs.length === 0) {
      showError(
        "No jobs found. Make sure job listings are visible on the left panel, then try again.",
      );
      isScanning = false;
      return;
    }

    showScanning(`Found ${jobs.length} jobs — asking Claude AI...`);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out after 45s")), 45000),
    );

    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "ANALYZE_JOBS", jobs, apiKey }),
      timeout,
    ]);

    if (!response.success) {
      showError("Claude API error: " + response.error);
      isScanning = false;
      return;
    }

    showResults(
      response.data.map((analysis, i) => ({ ...jobs[i], ...analysis })),
    );
  } catch (err) {
    showError("Error: " + err.message);
  }

  isScanning = false;
}

function collectJobs() {
  const jobs = [];
  const seen = new Set();

  // Every other span._794ff500 is the visible title (odd ones are aria-hidden duplicates)
  const titleSpans = Array.from(
    document.querySelectorAll("span._794ff500"),
  ).filter((_, i) => i % 2 === 0);

  for (const span of titleSpans) {
    try {
      // Walk up to the job card container
      const cardEl =
        span.closest("div._2f9e3fe1")?.parentElement?.parentElement;
      if (!cardEl) continue;

      const lines = cardEl.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      // Title is first line, strip "Selected, " prefix if present
      const title = lines[0]?.replace(/^Selected,\s*/i, "") || "";
      const company = lines[2] || "";
      const location = lines[3] || "";

      if (!title) continue;

      const key = `${title}|${company}`;
      if (seen.has(key)) continue;
      seen.add(key);

      jobs.push({ title, company, location, description: "" });
    } catch (e) {
      /* skip bad cards */
    }
  }

  // Grab the currently visible job description from the right panel
  // Stable pattern: LinkedIn always starts descriptions with "About the job"
  const descEl = Array.from(document.querySelectorAll("div")).find((d) =>
    d.innerText?.trim().startsWith("About the job"),
  );

  if (descEl && jobs.length > 0) {
    jobs[0].description = descEl.innerText.trim().slice(0, 3000);
  }

  return jobs;
}

function showScanning(message) {
  const body = document.getElementById("ljs-body");
  if (!body) return;
  body.innerHTML = `
    <div class="ljs-scanning">
      <div class="ljs-spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function showError(message) {
  const body = document.getElementById("ljs-body");
  if (!body) return;
  body.innerHTML = `
    <div class="ljs-error">
      <span class="ljs-error-icon">⚠️</span>
      <p>${message}</p>
      <button class="ljs-btn" id="ljs-retry-btn">↻ Try Again</button>
    </div>
  `;
  document.getElementById("ljs-retry-btn")?.addEventListener("click", () => {
    isScanning = false;
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (apiKey) startScan(apiKey);
    });
  });
}

function showResults(jobs) {
  const body = document.getElementById("ljs-body");
  if (!body) return;

  const seniorityColor = {
    Junior: "#22c55e",
    Mid: "#3b82f6",
    Senior: "#f59e0b",
    Lead: "#ef4444",
    Principal: "#8b5cf6",
  };
  const jobTypeIcon = { Remote: "🌐", Hybrid: "🏠", "On-site": "🏢" };

  body.innerHTML = `
    <div class="ljs-results-header">
      <span class="ljs-count">${jobs.length} jobs analyzed</span>
      <button class="ljs-rescan-btn" id="ljs-rescan">↻ Rescan</button>
    </div>
    <div class="ljs-jobs-list">
      ${jobs
        .map(
          (job, i) => `
        <div class="ljs-job-card" data-index="${i}">
          <div class="ljs-job-header">
            <div class="ljs-job-title-row">
              <span class="ljs-job-index">${i + 1}</span>
              <div>
                <div class="ljs-job-title">${esc(job.title)}</div>
                <div class="ljs-job-company">${esc(job.company)}${job.location ? " · " + esc(job.location) : ""}</div>
              </div>
            </div>
            <div class="ljs-badges">
              ${job.seniorityLevel ? `<span class="ljs-badge" style="background:${seniorityColor[job.seniorityLevel] || "#6b7280"}20;color:${seniorityColor[job.seniorityLevel] || "#6b7280"}">${job.seniorityLevel}</span>` : ""}
              ${job.jobType ? `<span class="ljs-badge ljs-badge-type">${jobTypeIcon[job.jobType] || ""} ${esc(job.jobType)}</span>` : ""}
            </div>
          </div>
          ${job.summary ? `<div class="ljs-job-summary">${esc(job.summary)}</div>` : ""}
          ${job.keySkills?.length ? `<div class="ljs-skills">${job.keySkills.map((s) => `<span class="ljs-skill">${esc(s)}</span>`).join("")}</div>` : ""}
          ${job.highlights?.length ? `<div class="ljs-highlights">${job.highlights.map((h) => `<div class="ljs-highlight">✦ ${esc(h)}</div>`).join("")}</div>` : ""}
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  document.getElementById("ljs-rescan")?.addEventListener("click", () => {
    isScanning = false;
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (apiKey) startScan(apiKey);
    });
  });
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
