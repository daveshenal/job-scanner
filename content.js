// content.js - Runs on LinkedIn jobs pages

let sidebar = null;
let isScanning = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_SCAN") {
    startScan(message.apiKey);
    sendResponse({ success: true });
  }
  if (message.type === "GET_STATUS") {
    sendResponse({ isScanning, hasSidebar: !!sidebar });
  }
  if (message.type === "TOGGLE_SIDEBAR") {
    toggleSidebar();
    sendResponse({ success: true });
  }
});

function toggleSidebar() {
  if (sidebar) {
    sidebar.classList.toggle("ljs-hidden");
  }
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
    <div class="ljs-body" id="ljs-body">
      <div class="ljs-scanning">
        <div class="ljs-spinner"></div>
        <p>Scanning jobs on this page...</p>
      </div>
    </div>
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
    const jobs = await collectJobs();

    if (jobs.length === 0) {
      showError(
        "No jobs found on this page. Make sure you're on a LinkedIn Jobs search results page.",
      );
      isScanning = false;
      return;
    }

    showScanning(`Analyzing ${jobs.length} jobs with Claude AI...`);

    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_JOBS",
      jobs,
      apiKey,
    });

    if (!response.success) {
      showError("Claude API error: " + response.error);
      isScanning = false;
      return;
    }

    // Merge analysis back with original jobs
    const enriched = response.data.map((analysis, i) => ({
      ...jobs[i],
      ...analysis,
    }));

    showResults(enriched);
  } catch (err) {
    showError("Something went wrong: " + err.message);
  }

  isScanning = false;
}

async function collectJobs() {
  const jobs = [];

  // LinkedIn job card selectors
  const jobCards = document.querySelectorAll(
    ".job-card-container, .jobs-search-results__list-item, [data-occludable-job-id]",
  );

  for (const card of jobCards) {
    try {
      const titleEl = card.querySelector(
        '.job-card-list__title, .job-card-container__link, [class*="job-card"] a',
      );
      const companyEl = card.querySelector(
        '.job-card-container__company-name, .artdeco-entity-lockup__subtitle span, [class*="company"]',
      );
      const locationEl = card.querySelector(
        '.job-card-container__metadata-item, [class*="location"], .artdeco-entity-lockup__caption',
      );

      const title = titleEl?.innerText?.trim() || "Unknown Title";
      const company = companyEl?.innerText?.trim() || "Unknown Company";
      const location = locationEl?.innerText?.trim() || "Unknown Location";

      if (title !== "Unknown Title" || company !== "Unknown Company") {
        jobs.push({ title, company, location, description: "" });
      }
    } catch (e) {
      // Skip bad cards
    }
  }

  // Try to get description from the currently open job panel
  const descriptionEl = document.querySelector(
    '.jobs-description__content, .job-view-layout, [class*="description"]',
  );
  if (descriptionEl && jobs.length > 0) {
    jobs[0].description = descriptionEl.innerText.trim().slice(0, 2000);
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
      <button class="ljs-btn" onclick="location.reload()">Retry</button>
    </div>
  `;
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

  const jobTypeIcon = {
    Remote: "🌐",
    Hybrid: "🏠",
    "On-site": "🏢",
  };

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
                <div class="ljs-job-title">${job.title || "Unknown Title"}</div>
                <div class="ljs-job-company">${job.company || ""} · ${job.location || ""}</div>
              </div>
            </div>
            <div class="ljs-badges">
              ${job.seniorityLevel ? `<span class="ljs-badge" style="background:${seniorityColor[job.seniorityLevel] || "#6b7280"}20;color:${seniorityColor[job.seniorityLevel] || "#6b7280"}">${job.seniorityLevel}</span>` : ""}
              ${job.jobType ? `<span class="ljs-badge ljs-badge-type">${jobTypeIcon[job.jobType] || ""} ${job.jobType}</span>` : ""}
            </div>
          </div>
          <div class="ljs-job-summary">${job.summary || ""}</div>
          ${
            job.keySkills?.length
              ? `
            <div class="ljs-skills">
              ${job.keySkills.map((s) => `<span class="ljs-skill">${s}</span>`).join("")}
            </div>
          `
              : ""
          }
          ${
            job.highlights?.length
              ? `
            <div class="ljs-highlights">
              ${job.highlights.map((h) => `<div class="ljs-highlight">✦ ${h}</div>`).join("")}
            </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  document.getElementById("ljs-rescan")?.addEventListener("click", () => {
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (apiKey) startScan(apiKey);
    });
  });
}
