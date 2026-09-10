// services/portfolio.service.js

import { supabase } from "../config/db.js";

const RANGE_CONFIG = {
  "24h": { hours: 24, bucket: "hour" },
  "7d": { hours: 7 * 24, bucket: "day" },
  "30d": { hours: 30 * 24, bucket: "day" },
  "90d": { hours: 90 * 24, bucket: "day" },
};

export const createPortfolioService = async ({
    userId,
    saveMode,
    name,
    description,
    templateId,
    siteData,
}) => {
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
};

export const listUserPortfolios = async (userId) => {

    const { data, error } = await supabase
        .from("portfolios")
        .select("*")
        .eq("userid", userId);
    if (error) {
        throw error;
    }
    return data;

}

export const getPortfoliosTraffic = async (portfolioId, range = "7d") => {

  const cfg = RANGE_CONFIG[range] ?? RANGE_CONFIG["7d"];
  const since = new Date(Date.now() - cfg.hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("portfolio_views")
    .select("viewed_at")
    .eq("portfolio_id", portfolioId)
    .gte("viewed_at", since);

  if (error) throw error;

  const buckets = {};
  for (const row of data) {
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
};

export const getPortfolioViews30d = async (portfolioId) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("portfolio_views")
    .select("*", { count: "exact", head: true })
    .eq("portfolio_id", portfolioId)
    .gte("viewed_at", since);

  if (error) throw error;
  return count ?? 0;
};

export const getPortfolioTotalViews = async (portfolioId) => {
  const { count, error } = await supabase
    .from("portfolio_views")
    .select("*", { count: "exact", head: true })
    .eq("portfolio_id", portfolioId);

  if (error) throw error;
  return count ?? 0;
};


export const getPortfolioById = async (portfolioId, userId) => {
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .eq("userid", userId) 
    .maybeSingle();

  if (error) throw error;
  return data;
};