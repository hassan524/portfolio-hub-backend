import { supabase } from "../config/db.js";
import seoService from "./seo.service.js";

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MIN_REINSPECT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours between checks

let workerTimer = null;
let isProcessing = false;

export async function runIndexingCheckCycle() {
  if (isProcessing) {
    console.log("[seoBackgroundWorker] Previous cycle still processing, skipping...");
    return;
  }

  isProcessing = true;
  try {
    // 1. Fetch submitted portfolios waiting for indexing from portfolio_seo
    const { data: seoRows, error } = await supabase
      .from("portfolio_seo")
      .select("portfolio_id, google_tokens, google_verified, sitemap_submitted, is_indexed, updated_at, inspection_result")
      .eq("sitemap_submitted", true)
      .eq("is_indexed", false)
      .not("google_tokens", "is", null)
      .limit(30);

    if (error) {
      console.warn("[seoBackgroundWorker] Could not query portfolio_seo:", error.message);
      return;
    }

    if (!seoRows || seoRows.length === 0) {
      return;
    }

    const now = Date.now();

    for (const seo of seoRows) {
      // Check if recently inspected (respect 12h interval)
      const lastInspected = seo.inspection_result?.lastInspectedAt;
      if (lastInspected) {
        const lastTime = new Date(lastInspected).getTime();
        if (!isNaN(lastTime) && now - lastTime < MIN_REINSPECT_INTERVAL_MS) {
          continue; // Already fresh
        }
      }

      // Fetch corresponding portfolio
      const { data: p } = await supabase
        .from("portfolios")
        .select("id, userid, name, isdeployed, liveurl, customdomain, iscustomdomain, domain_verified")
        .eq("id", seo.portfolio_id)
        .maybeSingle();

      if (!p || !p.isdeployed) continue;

      try {
        console.log(`[seoBackgroundWorker] Inspecting indexing for portfolio "${p.name || p.id}"...`);
        const result = await seoService.inspectUrl(p.id, p.userid);
        console.log(`[seoBackgroundWorker] Indexing check complete for "${p.name || p.id}": status=${result.indexingStatus}`);
      } catch (checkErr) {
        console.warn(`[seoBackgroundWorker] Inspection check skipped for "${p.name || p.id}":`, checkErr.message);
      }

      // Small delay between requests to respect Google rate limits
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error("[seoBackgroundWorker] Unexpected error in indexing cycle:", err);
  } finally {
    isProcessing = false;
  }
}

export function startSeoBackgroundWorker(intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
  if (workerTimer) {
    clearInterval(workerTimer);
  }

  // Initial check after 30 seconds of server startup
  setTimeout(() => {
    runIndexingCheckCycle().catch((e) => console.error("[seoBackgroundWorker] Startup cycle error:", e));
  }, 30_000);

  workerTimer = setInterval(() => {
    runIndexingCheckCycle().catch((e) => console.error("[seoBackgroundWorker] Interval cycle error:", e));
  }, intervalMs);

  return workerTimer;
}

export function stopSeoBackgroundWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[seoBackgroundWorker] Background worker stopped.");
  }
}

export default {
  startSeoBackgroundWorker,
  stopSeoBackgroundWorker,
  runIndexingCheckCycle,
};
