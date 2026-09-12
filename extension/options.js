const defaults = { apiBaseUrl: "http://localhost:8787", apiToken: "", failMode: "closed", timeoutMs: 15000 };

async function load() {
  const config = await chrome.storage.local.get(defaults);
  for (const key of ["apiBaseUrl", "apiToken", "failMode"]) document.getElementById(key).value = config[key];
}

document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    apiBaseUrl: document.getElementById("apiBaseUrl").value.replace(/\/$/, ""),
    apiToken: document.getElementById("apiToken").value,
    failMode: document.getElementById("failMode").value
  });
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

load();
