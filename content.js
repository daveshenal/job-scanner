// content.js - Runs on LinkedIn jobs pages

let sidebar = null;
let isScanning = false;

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
  if (message.type === "DEBUG_PAGE") {
    sendResponse({ html: debugPage() });
  }
});

function debugPage() {
  // Return useful debug info about what's on the page
  return {
    url: location.href,
    bodyClasses: document.body.className.slice(0, 200),
    jobCardCount: document.querySelectorAll(
      "[data-job-id], [data-occludable-job-id], .job-card-container",
    ).length,
    listItemCount: document.querySelectorAll(".jobs-search-results__list-item")
      .length,
    scaffoldCount: document.querySelectorAll(".scaffold-layout__list-item")
      .length,
    sampleHTML:
      document
        .querySelector(
          '.jobs-search-results__list, .jobs-search-results-grid, [class*="jobs-search"]',
        )
        ?.innerHTML?.slice(0, 500) || "No job list found",
  };
}

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
    const jobs = collectJobs();

    if (jobs.length === 0) {
      // Show debug info to help diagnose
      const debug = debugPage();
      showError(
        `No jobs found on this page.<br><br>` +
          `<small style="color:#64748b">` +
          `URL: ${debug.url.slice(0, 60)}<br>` +
          `Job cards found: ${debug.jobCardCount}<br>` +
          `List items: ${debug.listItemCount}<br>` +
          `Scaffold items: ${debug.scaffoldCount}<br><br>` +
          `Make sure you're on a LinkedIn job search results page and jobs are visible.</small>`,
      );
      isScanning = false;
      return;
    }

    showScanning(`Found ${jobs.length} jobs - asking Claude AI...`);

    // Add a timeout so it never hangs forever
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Request timed out after 30 seconds")),
        30000,
      ),
    );

    const responsePromise = chrome.runtime.sendMessage({
      type: "ANALYZE_JOBS",
      jobs,
      apiKey,
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    if (!response.success) {
      showError("Claude API error: " + response.error);
      isScanning = false;
      return;
    }

    const enriched = response.data.map((analysis, i) => ({
      ...jobs[i],
      ...analysis,
    }));

    showResults(enriched);
  } catch (err) {
    showError("Error: " + err.message);
  }

  isScanning = false;
}

function collectJobs() {
  const jobs = [];
  const seen = new Set();

  // Try multiple selector strategies - LinkedIn changes their DOM frequently
  const strategies = [
    // Strategy 1: data-job-id attribute (most reliable)
    () => document.querySelectorAll("[data-job-id]"),
    // Strategy 2: occludable job id
    () => document.querySelectorAll("[data-occludable-job-id]"),
    // Strategy 3: classic job card container
    () => document.querySelectorAll(".job-card-container"),
    // Strategy 4: search result list items
    () => document.querySelectorAll(".jobs-search-results__list-item"),
    // Strategy 5: scaffold layout list items (newer LinkedIn)
    () => document.querySelectorAll(".scaffold-layout__list-item"),
    // Strategy 6: any li inside the jobs list
    () =>
      document.querySelectorAll(
        '.jobs-search-results__list li, [class*="jobs-search-results"] li',
      ),
  ];

  let cards = [];
  for (const strategy of strategies) {
    const found = strategy();
    if (found.length > 0) {
      cards = Array.from(found);
      break;
    }
  }

  for (const card of cards) {
    try {
      // Title - try many selectors
      const titleEl =
        card.querySelector(".job-card-list__title--link") ||
        card.querySelector(".job-card-list__title") ||
        card.querySelector('[class*="job-card-list__title"]') ||
        card.querySelector('a[class*="job-card"]') ||
        card.querySelector("strong") ||
        card.querySelector('a[href*="/jobs/view/"]');

      // Company
      const companyEl =
        card.querySelector(".job-card-container__primary-description") ||
        card.querySelector(".job-card-container__company-name") ||
        card.querySelector('[class*="company-name"]') ||
        card.querySelector(".artdeco-entity-lockup__subtitle") ||
        card.querySelector('[class*="subtitle"]');

      // Location
      const locationEl =
        card.querySelector(".job-card-container__metadata-item") ||
        card.querySelector('[class*="metadata"]') ||
        card.querySelector(".artdeco-entity-lockup__caption") ||
        card.querySelector('[class*="location"]') ||
        card.querySelector('[class*="caption"]');

      const title = titleEl?.innerText?.trim() || titleEl?.textContent?.trim();
      const company =
        companyEl?.innerText?.trim() || companyEl?.textContent?.trim();
      const location =
        locationEl?.innerText?.trim() || locationEl?.textContent?.trim();

      // Skip if no meaningful data or duplicate
      if (!title && !company) continue;
      const key = `${title}|${company}`;
      if (seen.has(key)) continue;
      seen.add(key);

      jobs.push({
        title: title || "Unknown Title",
        company: company || "Unknown Company",
        location: location || "Unknown Location",
        description: "",
      });
    } catch (e) {
      // Skip bad cards silently
    }
  }

  // Also grab the currently visible job description panel
  const descEl =
    document.querySelector(".jobs-description__content") ||
    document.querySelector(".jobs-description-content") ||
    document.querySelector('[class*="jobs-description"]') ||
    document.querySelector(".job-view-layout");

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
                <div class="ljs-job-title">${escHtml(job.title || "Unknown Title")}</div>
                <div class="ljs-job-company">${escHtml(job.company || "")} · ${escHtml(job.location || "")}</div>
              </div>
            </div>
            <div class="ljs-badges">
              ${job.seniorityLevel ? `<span class="ljs-badge" style="background:${seniorityColor[job.seniorityLevel] || "#6b7280"}20;color:${seniorityColor[job.seniorityLevel] || "#6b7280"}">${job.seniorityLevel}</span>` : ""}
              ${job.jobType ? `<span class="ljs-badge ljs-badge-type">${jobTypeIcon[job.jobType] || ""} ${escHtml(job.jobType)}</span>` : ""}
            </div>
          </div>
          <div class="ljs-job-summary">${escHtml(job.summary || "")}</div>
          ${
            job.keySkills?.length
              ? `
            <div class="ljs-skills">
              ${job.keySkills.map((s) => `<span class="ljs-skill">${escHtml(s)}</span>`).join("")}
            </div>
          `
              : ""
          }
          ${
            job.highlights?.length
              ? `
            <div class="ljs-highlights">
              ${job.highlights.map((h) => `<div class="ljs-highlight">✦ ${escHtml(h)}</div>`).join("")}
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
    isScanning = false;
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (apiKey) startScan(apiKey);
    });
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
