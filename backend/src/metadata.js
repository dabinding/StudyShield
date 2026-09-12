// Resolve metadata by ID, never from a potentially stale YouTube SPA document.
export async function fetchMetadata(video, { fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY } = {}) {
  const url = apiKey
    ? new URL('https://www.googleapis.com/youtube/v3/videos')
    : new URL('https://www.youtube.com/oembed');
  if (apiKey) {
    url.search = new URLSearchParams({ part: 'snippet', id: video.videoId, key: apiKey });
  } else {
    url.search = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${video.videoId}`, format: 'json' });
  }
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Object.assign(new Error('metadata_unavailable'), { status: 503 });
  const data = await response.json();
  const item = apiKey ? data.items?.find(item => item.id === video.videoId)?.snippet : null;
  const title = apiKey ? item?.title : data.title;
  if (typeof title !== 'string' || !title.trim()) throw Object.assign(new Error('metadata_unavailable'), { status: 503 });
  return {
    videoId: video.videoId,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    title: title.slice(0, 500),
    description: apiKey ? (item.description || '').slice(0, 5000) : '',
    metadataSource: apiKey ? 'youtube_data_api' : 'youtube_oembed_title_only'
  };
}
