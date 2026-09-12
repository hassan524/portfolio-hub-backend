import { supabase } from "../config/db.js";
import vercelService from "./vercel.service.js";
import { slugifyProjectName } from "../utils/string.util.js";
import { extractDomain, countBy, toRanked } from "../utils/analytics.util.js";
import { getCountryFromIp } from "../utils/geo.util.js";

const RANGE_CONFIG = {
  "24h": { hours: 24, bucket: "hour" },
  "7d": { hours: 7 * 24, bucket: "day" },
  "30d": { hours: 30 * 24, bucket: "day" },
  "90d": { hours: 90 * 24, bucket: "day" },
};

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
  }) {
    const isDraft = saveMode === "draft";

    const { data, error } = await supabase
      .from("portfolios")
      .insert({
        userid: userId,
        name,
        description,
        templateid: templateId,
        sitedata: siteData,
        isdraft: isDraft,
        isdeployed: !isDraft,
      })
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
      .eq("userid", userId);

    if (error) {
      throw error;
    }
    return data || [];
  }

  // Track a new page view event for a portfolio
  async trackView({ portfolioId, referrer, path, ip }) {
    const country = ip ? getCountryFromIp(ip) : null;

    const { error } = await supabase.from("portfolio_views").insert({
      portfolio_id: portfolioId,
      referrer: referrer || null,
      path: path || null,
      country,
    });

    if (error) {
      console.error("Failed to insert portfolio view record:", error);
    }
  }

  // Get bucketed views over a time range (24h, 7d, 30d, 90d)
  async getPortfoliosTrafficViewsRange(portfolioId, range = "7d") {
    const cfg = RANGE_CONFIG[range] ?? RANGE_CONFIG["7d"];
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

    const steps = cfg.bucket === "hour" ? 24 : cfg.hours / 24;
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
      .select("platform, access_token")
      .eq("userid", userId)
      .in("platform", ["vercel", "netlify"]);

    if (credError) throw credError;

    const credential =
      credentials?.find((c) => c.platform === "vercel") ??
      credentials?.find((c) => c.platform === "netlify");

    if (!credential) {
      return { ...portfolio, platform: null, avgResponseMs, deployments: [] };
    }

    let deployments = [];
    if (credential.platform === "vercel") {
      const projectName = slugifyProjectName(portfolio.name);
      deployments = await vercelService.getVercelDeploymentHistory(credential.access_token, projectName, null, 10);
    }

    return {
      ...portfolio,
      platform: credential.platform,
      avgResponseMs,
      deployments,
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
}

export const portfolioService = new PortfolioService();
export default portfolioService;
