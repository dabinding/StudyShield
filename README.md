# Study Shield YouTube MVP

Study Shield pauses a YouTube video before playback, sends its ID, title, and description to a backend classifier, and resumes only approved educational videos. It supports normal watch pages, Shorts, live pages, embedded videos, and YouTube's single-page navigation.

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
- A browser extension cannot stop network buffering before a classification decision; it prevents playback, not the initial video request.
- The development options page is not an administrative security boundary. Production values should come from managed policy.
- The MVP has no teacher override, roster, audit database, admin dashboard, or YouTube Data API metadata verification yet.

## Tests

```bash
npm test
npm run check
```
