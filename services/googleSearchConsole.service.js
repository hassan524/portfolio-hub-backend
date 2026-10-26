import "dotenv/config";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/siteverification",
  "https://www.googleapis.com/auth/userinfo.email"
];

const oauth = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:5000/api/seo/google/callback"
  );

const normalizeUrl = (url) => {
  if (!url) return "";
  const clean = url.trim().replace(/\/+$/, "");
  return clean.startsWith("http") ? `${clean}/` : `https://${clean}/`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries transient Google API failures (429, 500, 502, 503, 504, network timeouts)
 */
async function executeWithRetry(fn, retries = 2, delayMs = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.status || err.code;
      const isTransient =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.message?.includes("rateLimitExceeded") ||
        err.message?.includes("userRateLimitExceeded");

      if (isTransient && attempt < retries) {
        const wait = delayMs * Math.pow(2, attempt);
        console.warn(
          `[GoogleSearchConsole] Transient error: ${err.message}. Retrying in ${wait}ms (attempt ${attempt + 1}/${retries})...`
        );
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export class GoogleSearchConsoleService {
  getAuthorizationUrl(userId, portfolioId) {
    const state = Buffer.from(JSON.stringify({ userId, portfolioId })).toString("base64url");
    return oauth().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state
    });
  }

  verifyStateToken(state) {
    try {
      return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  async exchangeCodeForTokens(code) {
    const auth = oauth();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const { data } = await google.oauth2({ version: "v2", auth }).userinfo.get();
    return { tokens, profile: { email: data.email } };
  }

  async getVerificationToken(tokens, siteUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    if (!url) return { token: "" };

    return executeWithRetry(async () => {
      const res = await google
        .siteVerification({ version: "v1", auth })
        .webResource.getToken({
          requestBody: {
            verificationMethod: "META",
            site: { type: "SITE", identifier: url }
          }
        })
        .catch((err) => {
          console.warn("[GoogleSearchConsole] getVerificationToken warning:", err.message);
          return null;
        });
      return { token: res?.data?.token || "" };
    });
  }

  async addSite(tokens, siteUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    if (!url) return { success: false };

    try {
      await google.searchconsole({ version: "v1", auth }).sites.add({ siteUrl: url });
      return { success: true, siteUrl: url };
    } catch (err) {
      console.warn("[GoogleSearchConsole] addSite notice:", err.message);
      return { success: false, error: err.message, siteUrl: url };
    }
  }

  async verifyOwnership(tokens, siteUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    const sc = google.searchconsole({ version: "v1", auth });

    return executeWithRetry(async () => {
      await sc.sites.add({ siteUrl: url }).catch((err) => {
        console.warn("[GoogleSearchConsole] sites.add notice:", err.message);
      });

      const siteInfo = await sc.sites.get({ siteUrl: url }).catch(() => null);
      if (
        siteInfo?.data?.permissionLevel === "siteOwner" ||
        siteInfo?.data?.permissionLevel === "siteFullUser"
      ) {
        return { success: true, verified: true, siteUrl: url };
      }

      try {
        await google.siteVerification({ version: "v1", auth }).webResource.insert({
          verificationMethod: "META",
          requestBody: { site: { type: "SITE", identifier: url } }
        });
        return { success: true, verified: true, siteUrl: url };
      } catch (err) {
        if (
          err.message?.includes("disabled") ||
          err.code === 403 ||
          err.status === 403
        ) {
          throw new Error(
            "Google Site Verification API is disabled. Please enable it in Google Cloud Console and retry."
          );
        }
        throw err;
      }
    });
  }

  async deleteSitemap(tokens, siteUrl, sitemapUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    const feed = sitemapUrl ? sitemapUrl.replace(/\/+$/, "") : `${url}sitemap.xml`;
    const searchConsole = google.searchconsole({ version: "v1", auth });

    let propertyUrl = url;
    try {
      const parsed = new URL(feed.startsWith("http") ? feed : `https://${feed}`);
      propertyUrl = normalizeUrl(parsed.origin);
    } catch {
      propertyUrl = url;
    }

    return executeWithRetry(async () => {
      try {
        await searchConsole.sitemaps.delete({ siteUrl: propertyUrl, feedpath: feed });
        console.log(`[GoogleSearchConsole] Deleted old sitemap "${feed}" from "${propertyUrl}"`);
        return { success: true, deleted: true, feedpath: feed, siteUrl: propertyUrl };
      } catch (err) {
        console.warn(`[GoogleSearchConsole] sitemaps.delete notice for "${feed}":`, err.message);
        return { success: false, error: err.message };
      }
    });
  }

  async cleanupOldSitemaps(tokens, propertyUrl, keepFeedUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const searchConsole = google.searchconsole({ version: "v1", auth });
    const normalizedKeep = (keepFeedUrl || "").trim().toLowerCase();
    const url = normalizeUrl(propertyUrl);

    try {
      const listRes = await executeWithRetry(() => searchConsole.sitemaps.list({ siteUrl: url }), 1).catch(() => null);
      const list = listRes?.data?.sitemap || [];
      for (const item of list) {
        const itemPath = (item.path || "").trim();
        if (itemPath && itemPath.toLowerCase() !== normalizedKeep) {
          console.log(`[GoogleSearchConsole] Removing mismatched sitemap "${itemPath}" from "${url}"`);
          await executeWithRetry(() => searchConsole.sitemaps.delete({ siteUrl: url, feedpath: itemPath }), 1).catch((delErr) => {
            console.warn(`[GoogleSearchConsole] Could not delete old sitemap "${itemPath}":`, delErr.message);
          });
        }
      }
    } catch (err) {
      console.warn(`[GoogleSearchConsole] cleanupOldSitemaps notice for "${url}":`, err.message);
    }
  }

  async submitSitemap(tokens, siteUrl, sitemapUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    const feed = sitemapUrl ? sitemapUrl.replace(/\/+$/, "") : `${url}sitemap.xml`;
    const searchConsole = google.searchconsole({ version: "v1", auth });

    // Ensure propertyUrl matches feed origin if feed is a full URL
    let propertyUrl = url;
    try {
      const parsed = new URL(feed.startsWith("http") ? feed : `https://${feed}`);
      propertyUrl = normalizeUrl(parsed.origin);
    } catch {
      propertyUrl = url;
    }

    return executeWithRetry(async () => {
      await searchConsole.sites.add({ siteUrl: propertyUrl }).catch((err) => {
        console.warn("[GoogleSearchConsole] sites.add notice:", err.message);
      });

      await searchConsole.sitemaps.submit({ siteUrl: propertyUrl, feedpath: feed });
      return { success: true, submitted: true, siteUrl: propertyUrl, feedpath: feed };
    });
  }

  /**
   * Retrieves actual sitemap processing status and errors from Google Search Console API.
   * Also verifies live sitemap HTTP response to provide detailed diagnostics.
   */
  async getSitemapStatus(tokens, siteUrl, sitemapUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    let url = normalizeUrl(siteUrl);
    const feed = sitemapUrl ? sitemapUrl.replace(/\/+$/, "") : `${url}sitemap.xml`;
    if (sitemapUrl) {
      try {
        const parsed = new URL(feed.startsWith("http") ? feed : `https://${feed}`);
        url = normalizeUrl(parsed.origin);
      } catch {
        url = normalizeUrl(siteUrl);
      }
    }
    const sc = google.searchconsole({ version: "v1", auth });

    try {
      let sitemapData = null;

      // 1. Try sitemaps.get with exact feedpath
      try {
        const res = await executeWithRetry(() => sc.sitemaps.get({ siteUrl: url, feedpath: feed }), 1);
        sitemapData = res.data;
      } catch (directErr) {
        // 2. If direct get fails, query sitemaps.list and match
        try {
          const listRes = await executeWithRetry(() => sc.sitemaps.list({ siteUrl: url }), 1);
          const list = listRes.data?.sitemap || [];
          sitemapData =
            list.find((item) => {
              const itemPath = (item.path || "").toLowerCase();
              return itemPath === feed.toLowerCase() || itemPath.endsWith("sitemap.xml");
            }) || null;
        } catch (listErr) {
          console.warn("[GoogleSearchConsole] sitemaps.list query also failed:", listErr.message);
        }
      }

      // 3. Directly diagnose the live sitemap URL accessibility
      let liveCheck = { reachable: true, status: 200, contentType: "application/xml", issue: null };
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const headRes = await fetch(feed, {
          method: "GET",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }
        });
        clearTimeout(t);
        const contentType = headRes.headers.get("content-type") || "";
        const text = await headRes.text();
        liveCheck.status = headRes.status;
        liveCheck.contentType = contentType;

        if (!headRes.ok) {
          liveCheck.reachable = false;
          liveCheck.issue = `Live sitemap returned HTTP ${headRes.status}`;
        } else if (
          !contentType.includes("xml") &&
          !text.trim().startsWith("<?xml") &&
          !text.includes("<urlset")
        ) {
          liveCheck.issue = `Live sitemap returned ${contentType || "HTML"} instead of XML (Google requires application/xml or text/xml)`;
        } else if (text.includes("__PORTFOLIO_SITE_URL__")) {
          liveCheck.issue = "Live sitemap contains unresolved placeholder URL (__PORTFOLIO_SITE_URL__)";
        }
      } catch (e) {
        liveCheck.reachable = false;
        liveCheck.issue = `Could not reach live sitemap URL: ${e.message}`;
      }

      if (!sitemapData) {
        return {
          success: true,
          foundInGoogle: false,
          status: "NOT_FOUND_IN_GSC",
          path: feed,
          lastSubmitted: null,
          lastDownloaded: null,
          isPending: false,
          warnings: 0,
          errors: 0,
          errorDetails: liveCheck.issue || "Sitemap has not yet been fetched by Google Search Console.",
          liveCheck
        };
      }

      const errors = Number(sitemapData.errors || 0);
      const warnings = Number(sitemapData.warnings || 0);
      const isPending = Boolean(sitemapData.isPending);
      const lastDownloaded = sitemapData.lastDownloaded || null;
      const lastSubmitted = sitemapData.lastSubmitted || null;

      let status = "SUCCESS";
      let errorDetails = null;

      if (errors > 0) {
        status = "ERROR";
        const parts = [
          `Google Search Console reported ${errors} error${errors > 1 ? "s" : ""} processing this sitemap.`
        ];
        if (lastDownloaded) {
          parts.push(`Last downloaded by Googlebot on ${new Date(lastDownloaded).toLocaleString()}.`);
        }
        if (liveCheck.issue) {
          parts.push(`Diagnostic: ${liveCheck.issue}.`);
        } else if (liveCheck.reachable) {
          parts.push(
            "Live sitemap is reachable (HTTP 200 XML). Re-submitting the sitemap can prompt Google to re-evaluate it."
          );
        }
        errorDetails = parts.join(" ");
      } else if (isPending) {
        status = "PENDING";
      } else if (lastDownloaded) {
        status = "SUCCESS";
      } else {
        status = "SUBMITTED";
      }

      return {
        success: true,
        foundInGoogle: true,
        status, // "ERROR" | "PENDING" | "SUCCESS" | "SUBMITTED"
        path: sitemapData.path || feed,
        lastSubmitted,
        lastDownloaded,
        isPending,
        warnings,
        errors,
        errorDetails,
        contents: sitemapData.contents || [],
        liveCheck
      };
    } catch (err) {
      console.error("[GoogleSearchConsole] getSitemapStatus error:", err.message);
      return {
        success: false,
        foundInGoogle: false,
        status: "UNABLE_TO_CHECK",
        error: err.message,
        errorDetails: `Unable to retrieve sitemap status from Google Search Console: ${err.message}`,
        path: feed
      };
    }
  }

  async inspectUrl(tokens, siteUrl, inspectionUrl) {
    const auth = oauth();
    auth.setCredentials(tokens);
    const url = normalizeUrl(siteUrl);
    const target = inspectionUrl ? normalizeUrl(inspectionUrl) : url;

    return executeWithRetry(async () => {
      const res = await google
        .searchconsole({ version: "v1", auth })
        .urlInspection.index.inspect({
          requestBody: { inspectionUrl: target, siteUrl: url }
        });

      const index = res.data?.inspectionResult?.indexStatusResult || {};
      return {
        success: true,
        inspectionResult: {
          verdict: index.verdict || "NEUTRAL",
          coverageState: index.coverageState || "Unknown",
          robotsTxtState: index.robotsTxtState || "ALLOWED",
          indexingState: index.indexingState || "INDEXING_STATE_UNSPECIFIED",
          pageFetchState: index.pageFetchState || "SUCCESSFUL",
          lastCrawlTime: index.lastCrawlTime || null,
          crawledAs: index.crawledAs || null,
          googleCanonical: index.googleCanonical || null,
          userCanonical: index.userCanonical || null,
          sitemap: index.sitemap || [],
          referringUrls: index.referringUrls || []
        }
      };
    });
  }
}

export const googleSearchConsoleService = new GoogleSearchConsoleService();
export default googleSearchConsoleService;