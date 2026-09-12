(() => {
  let activeVideoId = null;
  let state = "idle";
  let checkSequence = 0;

  function parseVideoId(urlString = location.href) {
    const url = new URL(urlString);
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]+)/);
    return match?.[1] ?? null;
  }

  function pauseAll() {
    document.querySelectorAll("video").forEach((video) => {
      if (!video.paused) video.pause();
    });
  }

  function guardPlayback(event) {
    if (state === "checking" || state === "blocked") {
      event.target.pause();
    }
  }

  function installVideoGuards() {
    document.querySelectorAll("video").forEach((video) => {
      if (video.dataset.studyShieldGuarded) return;
      video.dataset.studyShieldGuarded = "true";
      video.addEventListener("play", guardPlayback, true);
      video.addEventListener("playing", guardPlayback, true);
    });
  }

  function showOverlay(kind, reason = "") {
    let overlay = document.getElementById("study-shield-overlay");
    if (!overlay) {
      overlay = document.createElement("section");
      overlay.id = "study-shield-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-live", "assertive");
      document.documentElement.appendChild(overlay);
    }
    const checking = kind === "checking";
    const indicator = checking
      ? `<img class="study-shield-loading" src="${chrome.runtime.getURL("loading.webp")}" alt="" aria-hidden="true">`
      : `<div class="study-shield-mark" aria-hidden="true">🛡</div>`;
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="study-shield-card">
        ${indicator}
        <h1>${checking ? "Checking this video" : "Video blocked by Study Shield"}</h1>
        <p>${checking ? "Playback will begin if this video is approved for learning." : escapeHtml(reason)}</p>
        <small>${checking ? "Using the title and description for this first version." : "Ask your teacher if you believe this video supports your assignment."}</small>
      </div>`;
  }

  function hideOverlay() {
    const overlay = document.getElementById("study-shield-overlay");
    if (overlay) overlay.hidden = true;
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  }

  function metadata() {
    const meta = (selector) => document.querySelector(selector)?.content?.trim() ?? "";
    const title = meta('meta[name="title"]') || meta('meta[property="og:title"]') ||
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
      document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
    const description = meta('meta[name="description"]') || meta('meta[property="og:description"]') ||
      document.querySelector("#description-inline-expander")?.textContent?.trim() || "";
    return { title, description };
  }

  async function waitForMetadata(sequence) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const found = metadata();
      if (sequence !== checkSequence) return null;
      if (found.title && !/^youtube$/i.test(found.title)) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return metadata();
  }

  async function checkCurrentVideo(videoId) {
    const sequence = ++checkSequence;
    state = "checking";
    pauseAll();
    showOverlay("checking");
    const data = await waitForMetadata(sequence);
    if (!data || sequence !== checkSequence || videoId !== activeVideoId) return;

    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "CLASSIFY_YOUTUBE_VIDEO",
        video: { videoId, url: location.href, ...data }
      });
    } catch {
      result = { decision: { allowed: false, reason: "Study Shield could not contact its extension service." } };
    }
    if (sequence !== checkSequence || videoId !== activeVideoId) return;

    if (result?.decision?.allowed) {
      state = "allowed";
      hideOverlay();
      const video = document.querySelector("video");
      if (video) video.play().catch(() => {});
    } else {
      state = "blocked";
      pauseAll();
      showOverlay("blocked", result?.decision?.reason || "This video is not approved for school use.");
    }
  }

  function handleLocation() {
    installVideoGuards();
    const videoId = parseVideoId();
    if (videoId === activeVideoId) {
      if (state === "checking" || state === "blocked") pauseAll();
      return;
    }
    activeVideoId = videoId;
    checkSequence += 1;
    if (!videoId) {
      state = "idle";
      hideOverlay();
      return;
    }
    checkCurrentVideo(videoId);
  }

  function start() {
    if (!document.documentElement) {
      setTimeout(start, 0);
      return;
    }
    new MutationObserver(handleLocation).observe(document.documentElement, { childList: true, subtree: true });
    // Do not block YouTube-wide navigation. Search, channel pages, and the
    // YouTube header must remain usable even when the current video is denied.
    window.addEventListener("yt-navigate-start", () => setTimeout(handleLocation, 0), true);
    window.addEventListener("yt-navigate-finish", handleLocation, true);
    setInterval(handleLocation, 500);
    handleLocation();
  }

  start();
})();
