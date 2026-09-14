(() => {
  let checkedUrl = "";

  function websiteMetadata() {
    const url = new URL(location.href);
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content ?? "";
    return { url: url.href, domain: url.hostname, title: document.title, description: description.slice(0, 5000) };
  }

  function showBlocker(reason) {
    let overlay = document.getElementById("study-shield-website-overlay");
    if (!overlay) {
      overlay = document.createElement("section");
      overlay.id = "study-shield-website-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-live", "assertive");
      document.documentElement.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="study-shield-website-card">
        <img src="${chrome.runtime.getURL("assets/blocked-shield.webp")}" alt="" aria-hidden="true">
        <h1>Website blocked by Study Shield</h1>
        <p>${escapeHtml(reason)}</p>
        <button type="button">Go back</button>
        <small>Ask your teacher if you believe this website supports your assignment.</small>
      </div>`;
    overlay.querySelector("button").addEventListener("click", () => history.back());
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  }

  async function checkWebsite() {
    if (checkedUrl === location.href) return;
    checkedUrl = location.href;
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "CLASSIFY_WEBSITE", site: websiteMetadata() });
    } catch {
      result = { ok: false, decision: { allowed: false, reason: "Study Shield could not contact its extension service." } };
    }
    if (checkedUrl !== location.href || result?.decision?.allowed) return;
    showBlocker(result?.decision?.reason || "This website is not approved for school use.");
  }

  checkWebsite();
  window.addEventListener("popstate", checkWebsite);
})();
