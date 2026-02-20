import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

const GHOST_API_URL = "https://growthbook.ghost.io/ghost/api/content/posts/";
const GHOST_CONTENT_API_KEY = "aa6e8456ca151013e471debee4";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GhostRawPost {
  url: string;
  title: string;
  excerpt: string;
  published_at: string;
  html: string;
}

interface GhostResponse {
  posts: GhostRawPost[];
}

interface BlogPost {
  url: string;
  title: string;
  excerpt: string;
  published_at: string;
  reading_time: number;
}

interface BlogRecentResponse {
  status: 200;
  articles: BlogPost[];
  latestRelease: BlogPost | null;
}

let cachedResponse: BlogRecentResponse | null = null;
let cacheTimestamp = 0;

function countImages(html: string): number {
  if (!html) {
    return 0;
  }
  return (html.match(/<img("[^"]*"|'[^']*'|[^'">])+\/?>/g) || []).length;
}

function countWords(text: string): number {
  if (!text) {
    return 0;
  }

  text = text.replace(/<("[^"]*"|'[^']*'|[^'">])+\/?>/g, " "); // strip any HTML tags

  const pattern =
    /[a-zA-ZÀ-ÿ0-9_\u0392-\u03c9\u0410-\u04F9]+|[\u4E00-\u9FFF\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]+/g;

  const RTLPattern = /([\u0600-\u06ff]+|[\u0591-\u05F4]+)/g;

  const match = text.match(pattern) || text.match(RTLPattern);

  let count = 0;

  if (match === null) {
    return count;
  }

  for (let i = 0; i < match.length; i += 1) {
    if (match[i].charCodeAt(0) >= 0x4e00) {
      count += match[i].length;
    } else {
      count += 1;
    }
  }

  return count;
}

function estimatedReadingTimeInMinutes({
  wordCount,
  imageCount,
}: {
  wordCount: number;
  imageCount: number;
}): number {
  const wordsPerMinute = 275;
  const wordsPerSecond = wordsPerMinute / 60;
  let readingTimeSeconds = wordCount / wordsPerSecond;

  // add 12 seconds for the first image, 11 for the second, etc. limiting at 3
  for (let i = 12; i > 12 - imageCount; i -= 1) {
    readingTimeSeconds += Math.max(i, 3);
  }

  const readingTimeMinutes = Math.round(readingTimeSeconds / 60);

  return readingTimeMinutes;
}

function calculateReadingTime(post: GhostRawPost): number {
  if (!post.html) {
    return 0;
  }

  const imageCount = countImages(post.html);
  const wordCount = countWords(post.html);

  return estimatedReadingTimeInMinutes({ wordCount, imageCount });
}

function toBlogPost(raw: GhostRawPost): BlogPost {
  return {
    url: raw.url,
    title: raw.title,
    excerpt: raw.excerpt,
    published_at: raw.published_at,
    reading_time: calculateReadingTime(raw),
  };
}

async function fetchGhostPosts(
  tag: string,
  limit: number,
): Promise<BlogPost[]> {
  const params = new URLSearchParams({
    key: GHOST_CONTENT_API_KEY,
    filter: `tag:${tag}`,
    limit: String(limit),
    fields: "url,title,excerpt,published_at,html",
    order: "published_at desc",
  });

  const res = await fetch(`${GHOST_API_URL}?${params}`, {
    headers: { "Accept-Version": "v5.0" },
  });

  if (!res.ok) {
    throw new Error(`Ghost API returned ${res.status}`);
  }

  const data = (await res.json()) as GhostResponse;
  return (data.posts ?? []).map(toBlogPost);
}

export const getRecentBlogPosts = async (
  _req: AuthRequest,
  res: Response<BlogRecentResponse>,
) => {
  if (cachedResponse && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    res.status(200).json(cachedResponse);
    return;
  }

  try {
    const [articles, releases] = await Promise.all([
      fetchGhostPosts("hash-in-app", 2),
      fetchGhostPosts("release", 1),
    ]);

    cachedResponse = {
      status: 200,
      articles,
      latestRelease: releases[0] ?? null,
    };
    cacheTimestamp = Date.now();

    res.status(200).json(cachedResponse);
  } catch (e) {
    logger.error(e, "Failed to fetch blog posts from Ghost");
    res.status(200).json({
      status: 200,
      articles: [],
      latestRelease: null,
    });
  }
};
