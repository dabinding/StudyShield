(() => {
  let activeVideoId = null;
  let activeVideoKey = null;
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

  function isShortsPage(urlString = location.href) {
    return new URL(urlString).pathname.startsWith("/shorts/");
  }

  function guardPlayback(event) {
    if (state === "blocked") {
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

  function showOverlay(reason = "", unavailable = false) {
    let overlay = document.getElementById("study-shield-overlay");
    if (!overlay) {
      overlay = document.createElement("section");
      overlay.id = "study-shield-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-live", "assertive");
      document.documentElement.appendChild(overlay);
    }
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="study-shield-card">
        <img class="study-shield-mark" src="${chrome.runtime.getURL("assets/blocked-shield.webp")}" alt="" aria-hidden="true">
        <h1>${unavailable ? 'Video check unavailable' : 'Video blocked by Study Shield'}</h1>
        <p>${escapeHtml(reason)}</p>
        <small>Ask your teacher if you believe this video supports your assignment.</small>
      </div>`;
  }

  function hideOverlay() {
    const overlay = document.getElementById("study-shield-overlay");
    if (overlay) overlay.hidden = true;
  }

  function showLoading() {
    let loading = document.getElementById("study-shield-loading");
    if (!loading) {
      loading = document.createElement("div");
      loading.id = "study-shield-loading";
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-live", "polite");
      loading.innerHTML = `
        <img src="${chrome.runtime.getURL("assets/loading.webp")}" alt="">
        <span>Checking video…</span>`;
      document.documentElement.appendChild(loading);
    }
    loading.hidden = false;
  }

  function hideLoading() {
    const loading = document.getElementById("study-shield-loading");
    if (loading) loading.hidden = true;
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  }

  async function checkCurrentVideo(videoId) {
    const sequence = ++checkSequence;
    state = "checking";
    hideOverlay();
    showLoading();

    console.info("[Study Shield] Sending video for classification", {
      url: location.href,
      videoId,
      metadataSource: 'backend'
    });

    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "CLASSIFY_YOUTUBE_VIDEO",
        video: { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
      });
    } catch {
      result = { decision: { allowed: false, reason: "Study Shield could not contact its extension service." } };
    }
    if (sequence !== checkSequence || videoId !== activeVideoId) return;

    hideLoading();

    console.info("[Study Shield] Classification result", {
      url: location.href,
      videoId,
      requestSucceeded: Boolean(result?.ok),
      allowed: Boolean(result?.decision?.allowed),
      category: result?.decision?.category ?? "unknown",
      confidence: result?.decision?.confidence ?? 0,
      cached: Boolean(result?.decision?.cached),
      title: result?.decision?.title,
      metadataSource: result?.decision?.metadataSource,
      reason: result?.decision?.reason,
      error: result?.error ?? null
    });

    if (result?.decision?.allowed) {
      state = "allowed";
      hideOverlay();
    } else {
      state = "blocked";
      pauseAll();
      showOverlay(result?.decision?.reason || "This video is not approved for school use.", !result?.ok);
    }
  }

  function handleLocation() {
    installVideoGuards();
    const videoId = parseVideoId();
    const shorts = isShortsPage();
    const videoKey = videoId ? `${shorts ? "shorts" : "video"}:${videoId}` : null;
    if (videoKey === activeVideoKey) {
      if (state === "blocked") pauseAll();
      return;
    }
    activeVideoKey = videoKey;
    activeVideoId = videoId;
    checkSequence += 1;
    hideLoading();
    if (!videoId) {
      state = "idle";
      hideOverlay();
      return;
    }
    console.info("[Study Shield] Parsed YouTube video URL", {
      url: location.href,
      videoId
    });
    if (shorts) {
      state = "blocked";
      pauseAll();
      showOverlay("All YouTube Shorts are blocked by school policy.");
      console.info("[Study Shield] YouTube Short blocked without classification", {
        url: location.href,
        videoId
      });
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
