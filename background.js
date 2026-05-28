// background.js - Service worker for LinkedIn Job Scanner

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_JOBS") {
    analyzeJobsWithClaude(message.jobs, message.apiKey)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (message.type === "ANALYZE_SINGLE_JOB") {
    analyzeSingleJob(message.job, message.apiKey)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function analyzeJobsWithClaude(jobs, apiKey) {
  const jobList = jobs.map((j, i) =>
    `Job ${i + 1}:
    Title: ${j.title}
    Company: ${j.company}
    Location: ${j.location}
    Description: ${j.description || "Not loaded yet"}`
  ).join("\n\n---\n\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `You are a job analysis assistant. Analyze the following job listings and return a JSON array.

For each job return:
- title (string)
- company (string)
- location (string)
- summary (2 sentence max summary of the role)
- keySkills (array of top 5 skills required)
- seniorityLevel (Junior/Mid/Senior/Lead/Principal)
- jobType (Remote/Hybrid/On-site)
- highlights (array of 2-3 standout things about this role)

Return ONLY a valid JSON array, no markdown, no explanation.

Jobs to analyze:
${jobList}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Claude API error");
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  return JSON.parse(text);
}

async function analyzeSingleJob(job, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Analyze this job listing and return a JSON object.

Return:
- summary (2 sentence summary)
- keySkills (array of top 6 skills)
- seniorityLevel (Junior/Mid/Senior/Lead/Principal)
- jobType (Remote/Hybrid/On-site)
- highlights (array of 3 standout things)
- redFlags (array of any concerns, empty array if none)
- salaryEstimate (estimated range based on role/company/location, or "Not specified")

Return ONLY valid JSON, no markdown.

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description: ${job.description}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Claude API error");
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  return JSON.parse(text);
}
