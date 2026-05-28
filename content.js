// content.js - Runs on LinkedIn jobs pages
// Strategy: LinkedIn uses hashed/randomized class names that change every deploy.
// So we scrape by DOM structure and text content patterns instead.

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
  if (message.type === "DEBUG_PAGE") {
    sendResponse({ info: debugPage() });
  }
});

function debugPage() {
  const jobs = collectJobs();
  return {
    jobsFound: jobs.length,
    firstJob: jobs[0] || null,
    totalLiCount: document.querySelectorAll('li').length,
    visibleText: document.body.innerText.slice(0, 500)
  };
}

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
      showError(
        `No jobs found.<br><br>` +
        `<small style="color:#64748b">Make sure job listings are visible on the left panel, then try again.</small>`
      );
      isScanning = false;
      return;
    }

    showScanning(`Found ${jobs.length} jobs — asking Claude AI...`);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out after 45s")), 45000)
    );

    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "ANALYZE_JOBS", jobs, apiKey }),
      timeout
    ]);

    if (!response.success) {
      showError("Claude API error: " + response.error);
      isScanning = false;
      return;
    }

    showResults(response.data.map((analysis, i) => ({ ...jobs[i], ...analysis })));

  } catch (err) {
    showError("Error: " + err.message);
  }

  isScanning = false;
}

function collectJobs() {
  const jobs = [];
  const seen = new Set();

  // LinkedIn now uses hashed class names — so we find job cards by their
  // structural role: each job card is a <li> that contains:
  //   1. A visible job title span (the first meaningful text)
  //   2. A company name
  //   3. A location
  // We find the <ul> whose <li> children look like job cards.

  // Find all <li> elements that look like job cards
  const allLi = Array.from(document.querySelectorAll('li'));

  for (const li of allLi) {
    try {
      // Each job card li should have a role="button" or similar interactive div inside
      // and contain at least 3 distinct text nodes (title, company, location)
      const paragraphs = Array.from(li.querySelectorAll('p, span'))
        .map(el => el.innerText?.trim())
        .filter(t => t && t.length > 1 && t.length < 200);

      if (paragraphs.length < 2) continue;

      // Skip nav items, footers, etc.
      if (li.closest('nav') || li.closest('footer') || li.closest('header')) continue;

      // The title span uses _794ff500 class in current LinkedIn build
      // but we also fallback to first meaningful <p> text
      const titleSpan = li.querySelector('span._794ff500');
      const title = titleSpan
        ? titleSpan.innerText.trim()
        : paragraphs[0];

      if (!title || title.length < 3) continue;

      // Skip obvious non-job items
      const skipWords = ['home', 'jobs', 'messaging', 'notifications', 'network', 'post a job', 'sign in', 'join now'];
      if (skipWords.some(w => title.toLowerCase() === w)) continue;

      // Company: usually the paragraph right after the title
      // Location: usually contains city/country and "(Remote)" or "(Hybrid)"
      let company = '';
      let location = '';
      let salary = '';

      // Find salary (contains $ or /yr or /hr)
      const salaryEl = li.querySelector('span, p');
      const allTexts = Array.from(li.querySelectorAll('p, span'))
        .map(el => el.innerText?.trim())
        .filter(Boolean);

      for (const text of allTexts) {
        if (!salary && (text.includes('$') || text.includes('/yr') || text.includes('/hr'))) {
          salary = text;
        }
        if (!company && text !== title && text.length > 1 && text.length < 100 &&
            !text.includes('$') && !text.match(/\d+ (month|week|day|hour)s? ago/i) &&
            !text.includes('Easy Apply') && !text.includes('Apply') && company === '') {
          company = text;
        }
        if (!location && (
          text.includes('Remote') || text.includes('Hybrid') || text.includes('On-site') ||
          text.match(/[A-Z][a-z]+,\s[A-Z]{2}/) || // City, ST
          text.match(/[A-Z][a-z]+,\s[A-Z][a-z]+/)  // City, Country
        )) {
          location = text;
        }
      }

      const key = `${title}|${company}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Only add if it looks like a real job (has title + at least company or location)
      if (title && (company || location)) {
        jobs.push({
          title: title.slice(0, 120),
          company: company.slice(0, 100),
          location: location.slice(0, 100),
          salary: salary.slice(0, 50),
          description: ""
        });
      }

    } catch (e) { /* skip */ }
  }

  // Grab the currently open job description panel
  // Look for the largest text block on the right side of the page
  const descCandidates = Array.from(document.querySelectorAll('div, section, article'))
    .filter(el => {
      const text = el.innerText?.trim() || '';
      return text.length > 300 &&
        (text.toLowerCase().includes('responsibilities') ||
         text.toLowerCase().includes('requirements') ||
         text.toLowerCase().includes('qualifications') ||
         text.toLowerCase().includes('about the role') ||
         text.toLowerCase().includes('what you'));
    })
    .sort((a, b) => b.innerText.length - a.innerText.length);

  if (descCandidates.length > 0 && jobs.length > 0) {
    jobs[0].description = descCandidates[0].innerText.trim().slice(0, 3000);
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
    "Junior": "#22c55e", "Mid": "#3b82f6",
    "Senior": "#f59e0b", "Lead": "#ef4444", "Principal": "#8b5cf6"
  };
  const jobTypeIcon = { "Remote": "🌐", "Hybrid": "🏠", "On-site": "🏢" };

  body.innerHTML = `
    <div class="ljs-results-header">
      <span class="ljs-count">${jobs.length} jobs analyzed</span>
      <button class="ljs-rescan-btn" id="ljs-rescan">↻ Rescan</button>
    </div>
    <div class="ljs-jobs-list">
      ${jobs.map((job, i) => `
        <div class="ljs-job-card" data-index="${i}">
          <div class="ljs-job-header">
            <div class="ljs-job-title-row">
              <span class="ljs-job-index">${i + 1}</span>
              <div>
                <div class="ljs-job-title">${esc(job.title)}</div>
                <div class="ljs-job-company">${esc(job.company)} ${job.location ? '· ' + esc(job.location) : ''}</div>
                ${job.salary ? `<div class="ljs-salary">💰 ${esc(job.salary)}</div>` : ''}
              </div>
            </div>
            <div class="ljs-badges">
              ${job.seniorityLevel ? `<span class="ljs-badge" style="background:${seniorityColor[job.seniorityLevel]||'#6b7280'}20;color:${seniorityColor[job.seniorityLevel]||'#6b7280'}">${job.seniorityLevel}</span>` : ''}
              ${job.jobType ? `<span class="ljs-badge ljs-badge-type">${jobTypeIcon[job.jobType]||''} ${esc(job.jobType)}</span>` : ''}
            </div>
          </div>
          ${job.summary ? `<div class="ljs-job-summary">${esc(job.summary)}</div>` : ''}
          ${job.keySkills?.length ? `<div class="ljs-skills">${job.keySkills.map(s=>`<span class="ljs-skill">${esc(s)}</span>`).join('')}</div>` : ''}
          ${job.highlights?.length ? `<div class="ljs-highlights">${job.highlights.map(h=>`<div class="ljs-highlight">✦ ${esc(h)}</div>`).join('')}</div>` : ''}
        </div>
      `).join('')}
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
  return String(str || '')
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
