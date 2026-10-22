import { supabase } from "../config/db.js";
import vercelService from "./vercel.service.js";
import netlifyService from "./netlify.service.js";
import deployService from "./deploy.service.js";
import { slugifyProjectName } from "../utils/string.util.js";
import { extractDomain, countBy, toRanked } from "../utils/analytics.util.js";
import { getCountryFromIp } from "../utils/geo.util.js";

const RANGE_CONFIG = {
  "24h": { hours: 24, bucket: "hour" },
  "7d": { hours: 7 * 24, bucket: "day" },
  "30d": { hours: 30 * 24, bucket: "day" },
  "90d": { hours: 90 * 24, bucket: "day" },
};

// In-memory cache to deduplicate repeat hits from the same IP within a 60-second window
const recentViews = new Map();

function isDuplicateView(portfolioId, ip) {
  if (!ip || !portfolioId) return false;
  const key = `${portfolioId}:${ip}`;
  const now = Date.now();
  const lastTime = recentViews.get(key);

  if (lastTime && now - lastTime < 60_000) {
    return true;
  }

  recentViews.set(key, now);

  if (recentViews.size > 2000) {
    for (const [k, time] of recentViews.entries()) {
      if (now - time > 120_000) {
        recentViews.delete(k);
      }
    }
  }
  return false;
}

// Service for managing portfolio CRUD, views tracking, traffic analytics, and overview aggregation
export class PortfolioService {
  // Create a new portfolio
  async createPortfolio({
    userId,
    saveMode,
    name,
    description,
    templateId,
    siteData,
    liveUrl,
  }) {
    const isDraft = saveMode === "draft";

    const insertPayload = {
      userid: userId,
      name,
      description,
      templateid: templateId,
      sitedata: siteData,
      isdraft: isDraft,
      isdeployed: !isDraft,
    };
    if (liveUrl) {
      insertPayload.liveurl = liveUrl;
    }

    const { data, error } = await supabase
      .from("portfolios")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }



  // Get list of portfolios for a user
  async listUserPortfolios(userId) {
    const { data, error } = await supabase
      .from("portfolios")
      .select("*")
      .eq("userid", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }
    return data || [];
  }

  // Track a new page view event for a portfolio
  async trackView({ portfolioId, referrer, path, ip, country: providedCountry }) {
    if (!portfolioId) return;

    let targetPortfolioId = portfolioId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(portfolioId);

    // If portfolioId is not a UUID (for example, if a template ID or slug was passed),
    // look up the corresponding portfolio in the database to find its actual UUID
    if (!isUuid) {
      console.log(`[trackView] non-uuid portfolioId received: "${portfolioId}". Attempting lookup...`);
      const { data: matchedPortfolio, error: lookupError } = await supabase
        .from("portfolios")
        .select("id")
        .or(`templateid.eq.${portfolioId},name.eq.${portfolioId}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lookupError || !matchedPortfolio) {
        console.warn(`[trackView] could not resolve portfolio for identifier "${portfolioId}":`, lookupError?.message || "Not found");
        return;
      }
      targetPortfolioId = matchedPortfolio.id;
    }

    // Suppress rapid duplicate view events from the same IP
    if (isDuplicateView(targetPortfolioId, ip)) {
      console.log(`[trackView] Duplicate view from ${ip} for portfolio ${targetPortfolioId} suppressed (cooldown window active)`);
      return;
    }

    const country = providedCountry || (ip ? getCountryFromIp(ip) : null);

    const { error } = await supabase.from("portfolio_views").insert({
      portfolio_id: targetPortfolioId,
      referrer: referrer || null,
      path: path || null,
      country,
    });

    if (error) {
      console.error("Failed to insert portfolio view record:", error);
    } else {
      console.log(`[trackView] Successfully recorded view for portfolio ${targetPortfolioId}`);
    }
  }

  // Get bucketed views over a time range (24h, 7d, 30d, 90d)
  async getPortfoliosTrafficViewsRange(portfolioId, range = "7d") {
    const { data: pRow } = await supabase
      .from("portfolios")
      .select("created_at")
      .eq("id", portfolioId)
      .maybeSingle();

    const createdAt = pRow?.created_at ? new Date(pRow.created_at) : null;
    const now = new Date();
    const isCreatedToday =
      createdAt &&
      now.toISOString().slice(0, 10) === createdAt.toISOString().slice(0, 10);

    // If site was created today, showing 7 days ago (e.g. Oct 15) is incorrect;
    // show today's 24h hourly timeline so users see live hourly traffic.
    const effectiveRange = (isCreatedToday && range === "7d") ? "24h" : range;
    const cfg = RANGE_CONFIG[effectiveRange] ?? RANGE_CONFIG["7d"];
    const since = new Date(Date.now() - cfg.hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("portfolio_views")
      .select("viewed_at")
      .eq("portfolio_id", portfolioId)
      .gte("viewed_at", since);

    if (error) throw error;

    const buckets = {};
    for (const row of data || []) {
      const d = new Date(row.viewed_at);
      const key = cfg.bucket === "hour"
        ? d.toISOString().slice(0, 13)
        : d.toISOString().slice(0, 10);
      buckets[key] = (buckets[key] || 0) + 1;
    }

    let steps = cfg.bucket === "hour" ? 24 : cfg.hours / 24;
    // If daily bucket, never go back before the portfolio's creation date
    if (cfg.bucket === "day" && createdAt) {
      const daysSinceCreation = Math.ceil((now.getTime() - createdAt.getTime()) / (86_400_000));
      steps = Math.min(steps, Math.max(daysSinceCreation + 1, 2));
    }

    const stepMs = cfg.bucket === "hour" ? 3600_000 : 86_400_000;

    const dates = [];
    const seriesData = [];

    for (let i = steps - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * stepMs);
      const key = cfg.bucket === "hour" ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
      const label = cfg.bucket === "hour"
        ? d.toLocaleTimeString("en-US", { hour: "numeric" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      dates.push(label);
      seriesData.push(buckets[key] || 0);
    }

    return { dates, seriesData };
  }

  // Get 30 day total view count
  async getPortfolioViews30d(portfolioId) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from("portfolio_views")
      .select("*", { count: "exact", head: true })
      .eq("portfolio_id", portfolioId)
      .gte("viewed_at", since);

    if (error) throw error;
    return count ?? 0;
  }

  // Get all time total view count
  async getPortfolioTotalViews(portfolioId) {
    const { count, error } = await supabase
      .from("portfolio_views")
      .select("*", { count: "exact", head: true })
      .eq("portfolio_id", portfolioId);

    if (error) throw error;
    return count ?? 0;
  }

  // Get single portfolio by ID
  async getPortfolioById(portfolioId, userId) {
    const { data, error } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolioId)
      .eq("userid", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // Get portfolio along with Vercel deploy credentials and project name
  async getPortfolioDeployInfo(portfolioId, userId) {
    const portfolio = await this.getPortfolioById(portfolioId, userId);
    if (!portfolio) {
      const err = new Error("Portfolio not found");
      err.status = 404;
      throw err;
    }

    const { data: credential } = await supabase
      .from("deploy_credentials")
      .select("access_token")
      .eq("userid", userId)
      .eq("platform", "vercel")
      .maybeSingle();

    if (!credential?.access_token) {
      const err = new Error("Connect Vercel first.");
      err.status = 424;
      throw err;
    }

    const host = (portfolio.liveurl || "").replace(/^https?:\/\//, "").split("/")[0];
    if (!host.endsWith(".vercel.app")) {
      const err = new Error("Deploy this portfolio to Vercel first.");
      err.status = 400;
      throw err;
    }

    return {
      portfolio,
      token: credential.access_token,
      projectName: host.replace(".vercel.app", ""),
    };
  }

  // Get overview statistics, live URL response time, and deployment history
  async getPortfolioOverview(portfolioId, userId) {
    const portfolio = await this.getPortfolioById(portfolioId, userId);
    if (!portfolio) return null;

    if (!portfolio.isdeployed || !portfolio.liveurl) {
      return { ...portfolio, platform: null, avgResponseMs: null, deployments: [] };
    }

    let avgResponseMs = null;
    const timings = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      try {
        const res = await fetch(portfolio.liveurl, { method: "HEAD" });
        if (res.ok) timings.push(Date.now() - start);
      } catch {
        // ignore latency check errors
      }
    }
    if (timings.length) {
      avgResponseMs = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
    }

    const { data: credentials, error: credError } = await supabase
      .from("deploy_credentials")
      .select("platform, access_token, team_id")
      .eq("userid", userId)
      .in("platform", ["vercel", "netlify"]);

    if (credError) throw credError;

    const targetPlatform = portfolio.hosting || "vercel";
    const credential =
      credentials?.find((c) => c.platform === targetPlatform) ??
      credentials?.find((c) => c.platform === "vercel") ??
      credentials?.find((c) => c.platform === "netlify");

    // Resolve accurate project slug from liveurl (e.g. https://clothing-brand-dev.vercel.app -> clothing-brand-dev)
    let projectName = null;
    if (portfolio.liveurl) {
      try {
        const raw = portfolio.liveurl.startsWith("http") ? portfolio.liveurl : `https://${portfolio.liveurl}`;
        const hostname = new URL(raw).hostname;
        if (hostname.endsWith(".vercel.app")) {
          projectName = hostname.replace(".vercel.app", "");
        } else if (hostname.endsWith(".netlify.app")) {
          projectName = hostname.replace(".netlify.app", "");
        }
      } catch {
        // ignore url parse error
      }
    }
    if (!projectName) {
      projectName = slugifyProjectName(portfolio.name);
    }

    let deployments = [];
    if (credential && credential.platform === "vercel") {
      try {
        deployments = await vercelService.getVercelDeploymentHistory(
          credential.access_token,
          projectName,
          credential.team_id || null,
          10
        );
      } catch (err) {
        console.warn("[getPortfolioOverview] Vercel deployment history fetch warning:", err.message);
      }
    }

    // Fallback: If live and deployed, guarantee at least 1 production deployment row
    if (deployments.length === 0 && portfolio.isdeployed && portfolio.liveurl) {
      deployments = [
        {
          id: `dpl_${portfolio.id.replace(/-/g, "").slice(0, 12)}`,
          status: "success",
          message: "Production deployment",
          url: portfolio.liveurl.startsWith("http") ? portfolio.liveurl : `https://${portfolio.liveurl}`,
          createdAt: portfolio.updated_at || portfolio.created_at || new Date().toISOString(),
        },
      ];
    }

    const totalviews = await this.getPortfolioTotalViews(portfolioId);

    return {
      ...portfolio,
      platform: portfolio.hosting || credential?.platform || (portfolio.liveurl?.includes("vercel") ? "vercel" : "netlify"),
      avgResponseMs,
      deployments,
      totalviews,
    };
  }

  // Get ranked traffic sources, pages, and countries breakdown
  async getPortfoliosTraffic(portfolioId) {
    const { data: rows, error } = await supabase
      .from("portfolio_views")
      .select("referrer, path, country")
      .eq("portfolio_id", portfolioId);

    if (error) throw error;

    const totalViews = (rows || []).length;

    const sourceCounts = countBy(rows, (r) => extractDomain(r.referrer));
    const topSources = toRanked(sourceCounts, totalViews, 5);

    const pageCounts = countBy(rows, (r) => r.path || "/");
    const topPages = Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([path, views]) => ({ path, views }));

    const countryCounts = countBy(rows, (r) => r.country || "Unknown");
    const topCountries = toRanked(countryCounts, totalViews, 8);

    return {
      totalViews,
      topSources,
      topPages,
      topCountries,
    };
  }

  // Update saved siteData for a portfolio with owner check
  async updatePortfolioSiteData(portfolioId, userId, { siteData, name, description }) {
    if (!portfolioId) throw new Error("Portfolio ID is required");
    if (!siteData) throw new Error("siteData is required");

    // Check ownership
    const { data: existing, error: findError } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolioId)
      .eq("userid", userId)
      .maybeSingle();

    if (findError) throw findError;
    if (!existing) {
      const err = new Error("Portfolio not found or access denied");
      err.status = 404;
      throw err;
    }

    const updatePayload = {
      sitedata: siteData,
      updated_at: new Date().toISOString(),
    };
    if (name) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description;

    const { data, error } = await supabase
      .from("portfolios")
      .update(updatePayload)
      .eq("id", portfolioId)
      .eq("userid", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Redeploy an existing live portfolio, reusing its existing project name on Vercel
  async redeployPortfolio(portfolioId, userId, files) {
    if (!portfolioId) throw new Error("Portfolio ID is required");
    if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
      throw new Error("Missing deployment files");
    }

    // Owner check
    const { data: portfolio, error: findError } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolioId)
      .eq("userid", userId)
      .maybeSingle();

    if (findError) throw findError;
    if (!portfolio) {
      const err = new Error("Portfolio not found or access denied");
      err.status = 404;
      throw err;
    }

    const platform = portfolio.hosting || "vercel";
    const credential = await deployService.getUserDeployCredential(userId, platform);
    if (!credential) {
      const err = new Error(`${platform === "vercel" ? "Vercel" : "Netlify"} not connected`);
      err.status = 400;
      throw err;
    }

    // Re-use existing project name
    let existingProjectName = null;
    if (portfolio.liveurl) {
      try {
        const raw = portfolio.liveurl.startsWith("http") ? portfolio.liveurl : `https://${portfolio.liveurl}`;
        const hostname = new URL(raw).hostname;
        if (hostname.endsWith(".vercel.app")) {
          existingProjectName = hostname.replace(".vercel.app", "");
        } else if (hostname.endsWith(".netlify.app")) {
          existingProjectName = hostname.replace(".netlify.app", "");
        }
      } catch {
        // ignore url parse error
      }
    }
    if (!existingProjectName) {
      existingProjectName = slugifyProjectName(portfolio.name || `portfolio-${userId.slice(0, 8)}`);
    }

    if (platform === "vercel") {
      const result = await vercelService.deployReactProjectToVercel(
        credential.access_token,
        existingProjectName,
        files,
        credential.team_id,
        portfolio.id
      );
      return result;
    } else {
      const htmlContent = files["index.html"] || files["public/index.html"] || "";
      const result = await netlifyService.deployHtmlToNetlify(
        credential.access_token,
        existingProjectName,
        htmlContent,
        files
      );
      return result;
    }
  }
}

export const portfolioService = new PortfolioService();
export default portfolioService;
