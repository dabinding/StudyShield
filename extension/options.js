const defaults = {
  apiBaseUrl: "http://localhost:8787", apiToken: "", failMode: "closed", timeoutMs: 25000,
  studentName: "", deviceLabel: "", screenshotEnabled: false, screenshotIntervalSeconds: 60
};

function normalizeApiToken(value) {
  const token = String(value ?? "").trim();
  if (token.length >= 2 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
    return token.slice(1, -1);
  }
  return token;
}

async function load() {
  const config = await chrome.storage.local.get(defaults);
  for (const key of ["apiBaseUrl", "apiToken", "failMode", "studentName", "deviceLabel", "screenshotIntervalSeconds"]) {
    document.getElementById(key).value = config[key];
  }
  document.getElementById("screenshotEnabled").checked = config.screenshotEnabled;
}

document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    apiBaseUrl: document.getElementById("apiBaseUrl").value.replace(/\/$/, ""),
    apiToken: normalizeApiToken(document.getElementById("apiToken").value),
    failMode: document.getElementById("failMode").value,
    studentName: document.getElementById("studentName").value.trim(),
    deviceLabel: document.getElementById("deviceLabel").value.trim(),
    screenshotEnabled: document.getElementById("screenshotEnabled").checked,
    screenshotIntervalSeconds: Number(document.getElementById("screenshotIntervalSeconds").value) || 60
  });
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

load();
