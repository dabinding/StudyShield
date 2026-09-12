# Study Shield YouTube MVP

## Classification pipeline (v3)

The extension submits only a video ID and canonical URL. The backend resolves metadata directly from YouTube, avoiding stale titles when switching between videos. Timestamps and playlist parameters do not change the cache identity. AI mode uses the Responses API; heuristic mode is only a keyword-based development fixture.

Set `YOUTUBE_API_KEY` on the backend to use YouTube Data API v3 for the title and full description. Without it, the backend uses YouTube oEmbed for the verified title only (oEmbed has no description). Client-provided metadata is ignored. Retrieval failures are reported as unavailable rather than non-educational. Uncertain decisions are cached for at most one minute; other decisions retain the configured TTL. Restart the backend after changing models or policies to clear its cache.

Set `APPROVED_YOUTUBE_VIDEO_IDS` to a comma-separated list of teacher-approved video IDs. These videos are allowed by school policy before metadata retrieval or AI classification, which supports classroom exceptions without weakening the general classifier. For example:

```dotenv
APPROVED_YOUTUBE_VIDEO_IDS=HtxOsOuY7hA,anotherVideoId
```

The console logs the resolved title, metadata source, category, reason, and cache status. API failures still follow the configured failure policy, with a separate “Video check unavailable” heading. Playback proceeds silently while checking, and approval does not restart a video you manually paused.

Study Shield lets a regular YouTube video begin while it sends the video ID to a backend classifier. Approved videos continue without interruption; denied videos are paused and covered by a block message. All `/shorts/` videos are blocked locally without an API call. Normal watch pages, live pages, embedded videos, and YouTube's single-page navigation are supported.

## Run locally

Requirements: Node.js 20+ and an OpenAI API key.

```bash
cd study-shield
cp .env.example .env
export OPENAI_API_KEY="your-key"
export STUDY_SHIELD_API_TOKEN="your-long-random-token"
npm start
```

For UI testing without an API key, run the intentionally limited keyword classifier:

```bash
CLASSIFIER_MODE=heuristic npm start
```

Load `study-shield/extension` as an unpacked extension from `chrome://extensions`, open its settings, and configure the backend URL and matching API token. Visit a YouTube video to test it.

## API

`POST /v1/classify/youtube`

```json
{
  "videoId": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Video title",
  "description": "Video description"
}
```

The response includes `allowed`, `category`, `confidence`, `reason`, `videoId`, and `cached`. The server defaults to blocking `uncertain` classifications. Set `ALLOW_UNCERTAIN=true` only if the school explicitly prefers availability over strict filtering.

## Production deployment checklist

- Host the backend behind HTTPS. Never ship the OpenAI key in the extension.
- Replace the shared bearer token with device/user authentication before a district-wide rollout. A shared extension secret can be extracted by a determined user and is only an MVP control.
- Store classification decisions in Redis or a database; the included cache is per-process and in memory.
- Restrict backend ingress, add centralized rate limiting, structured logs, monitoring, and alerting.
- Configure `apiBaseUrl`, `apiToken`, `failMode`, and `timeoutMs` through Chrome Enterprise managed extension policy using `policy-schema.json`.
- Publish the extension privately and force-install it for a test organizational unit first.
- Narrow `<all_urls>` in `host_permissions` to the production API origin plus YouTube before publication.
- Establish review/override, retention, privacy-notice, and false-positive handling procedures.

## Known MVP limitations

- YouTube changes its markup periodically. Title extraction has several fallbacks, but integration tests against YouTube should run regularly.
- Classification uses creator-supplied metadata and can be wrong or deliberately misleading.
- A denied video can play briefly while classification is in progress, so this mode prioritizes a smooth experience over pre-playback enforcement.
- The development options page is not an administrative security boundary. Production values should come from managed policy.
- The MVP override is a backend environment setting rather than a teacher-facing workflow. It has no roster, audit database, or admin dashboard yet.

## Tests

`npm run test:videos` runs ten live AI regression cases (Minecraft, Roblox, Fortnite, Call of Duty, ASMR, one Short, geometry, algebra, calculus, and forces/motion). It loads `.env`, requires both API keys, fetches actual YouTube title/description, and calls OpenAI directly without the decision cache. This consumes API quota and OpenAI usage. Normal `npm test` remains offline and includes the school-approved video override.

Each live case asserts the semantic category and playback decision using the backend's policy function. The `#aura` Short has no description: either non-educational or uncertain is accepted, but playback must be blocked. This does not establish that all Shorts are non-educational. API failures fail the suite rather than counting as successful blocks. The suite prints actual titles, description lengths, reasons, categories, and decisions, without credentials. It tests the backend classification path, not Chrome playback enforcement.

```bash
npm test
npm run check
```

## Browser diagnostics

Open Developer Tools on the YouTube page and filter the Console for `Study Shield`. For each video navigation, the extension logs the parsed URL and video ID, the metadata sent for classification, and the returned category, confidence, cache status, or request error. Descriptions are not written to the console.
