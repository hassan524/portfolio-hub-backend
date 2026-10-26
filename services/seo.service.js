import { supabase } from "../config/db.js";
import googleSearchConsoleService from "./googleSearchConsole.service.js";

const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

const fullUrl = (u = "") =>
  (/^https?:\/\//.test(u) ? u : `https://${u}`).replace(/\/+$/, "");

class SeoService {
  async assertOwner(portfolioId, userId) {
    let query = supabase
      .from("portfolios")
      .select("id, userid, name, description, liveurl, customdomain, iscustomdomain, domain_verified, isdeployed, hosting, sitedata")
      .eq("id", portfolioId);

    if (userId) {
      query = query.eq("userid", userId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("[SeoService] assertOwner error:", error);
      throw httpError(500, error.message);
    }
    if (!data) {
      throw httpError(404, "Portfolio not found or unauthorized");
    }
    return data;
  }

  async getRow(portfolioId) {
    const { data, error } = await supabase
      .from("portfolio_seo")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.warn("[SeoService] getRow warning:", error.message);
    }
    return data;
  }

  // Format DB row + portfolio into full SeoData object expected by frontend & API
  formatSeo(portfolio, seoRow) {
    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const liveUrl = activeDomain ? fullUrl(activeDomain) : null;
    const sitemapUrl = liveUrl ? `${liveUrl}/sitemap.xml` : null;

    const insp = seoRow?.inspection_result || {};
    const hasTokens = Boolean(seoRow?.google_tokens && Object.keys(seoRow.google_tokens).length > 0);
    const googleConnected = hasTokens || Boolean(seoRow?.google_account_email) || Boolean(seoRow?.google_verified);
    const ownershipVerified = Boolean(seoRow?.google_verified);
    const searchConsoleSubmitted = Boolean(seoRow?.sitemap_submitted);
    const isIndexed = Boolean(
      seoRow?.is_indexed ||
      insp.verdict === "PASS" ||
      (insp.coverageState && insp.coverageState.toLowerCase().includes("indexed") && !insp.coverageState.toLowerCase().includes("not indexed"))
    );

    const sitemapStatus = insp.sitemapStatus || (searchConsoleSubmitted ? "SUCCESS" : "NOT_SUBMITTED");

    return {
      portfolioId: portfolio.id,
      title: seoRow?.title || portfolio.sitedata?.seo?.title || portfolio.name || "",
      description: seoRow?.description || portfolio.sitedata?.seo?.description || portfolio.description || "",
      keywords: seoRow?.keywords || portfolio.sitedata?.seo?.keywords || "",
      googleVerificationCode: seoRow?.google_verification_token || "",
      googleToken: seoRow?.google_verification_token || "", // backward-compatibility

      liveUrl,
      siteUrl: liveUrl,
      sitemapUrl,
      customDomain: portfolio.customdomain || null,
      domainVerified: Boolean(portfolio.domain_verified),
      isDeployed: Boolean(portfolio.isdeployed),
      hosting: portfolio.hosting || null,

      googleConnected,
      googleAccountEmail: seoRow?.google_account_email || null,

      ownershipVerified,
      googleVerified: ownershipVerified, // backward-compatibility
      verificationError: insp.verificationError || null,

      searchConsoleSubmitted,
      sitemapSubmitted: searchConsoleSubmitted, // backward-compatibility
      sitemapSubmittedAt: insp.sitemapSubmittedAt || seoRow?.updated_at || null,
      sitemapProcessingStatus: sitemapStatus,
      sitemapErrors: Number(insp.sitemapErrors || 0),
      sitemapWarnings: Number(insp.sitemapWarnings || 0),
      sitemapLastDownloaded: insp.sitemapLastDownloaded || null,
      sitemapErrorDetails: insp.sitemapErrorDetails || null,

      indexingStatus: isIndexed ? "INDEXED" : (insp.indexingStatus || (searchConsoleSubmitted ? "DISCOVERED" : "NOT_CHECKED")),
      isIndexed,
      isUrlOnGoogle: isIndexed,
      urlInspectionVerdict: insp.verdict || null,
      urlInspectionError: insp.inspectionError || null,
      pageIndexingReportStatus: insp.pageIndexingReportStatus || (isIndexed || searchConsoleSubmitted ? "Processing data, please check again in a day or so" : null),
      inspectionResult: insp.indexStatusResult || insp || null,
    };
  }

  // 1. GET /api/seo/:portfolioId
  async getSeo(portfolioId, userId) {
    const portfolio = await this.assertOwner(portfolioId, userId);
    const seoRow = await this.getRow(portfolioId);
    return this.formatSeo(portfolio, seoRow);
  }

  // 2. PUT /api/seo/:portfolioId
  async updateSeo(portfolioId, userId, { title, description, keywords, googleVerificationCode }) {
    const portfolio = await this.assertOwner(portfolioId, userId);

    const cleanTitle = (title || "").trim();
    const cleanDesc = (description || "").trim();
    const cleanKeywords = (keywords || "").trim();
    const cleanToken = (googleVerificationCode || "").trim();

    const patch = {
      portfolio_id: portfolioId,
      title: cleanTitle,
      description: cleanDesc,
      keywords: cleanKeywords,
      updated_at: new Date().toISOString(),
    };

    if (cleanToken) {
      patch.google_verification_token = cleanToken;
    }

    const { error: upsertErr } = await supabase
      .from("portfolio_seo")
      .upsert(patch, { onConflict: "portfolio_id" });

    if (upsertErr) {
      console.error("[SeoService] updateSeo upsert error:", upsertErr);
      throw httpError(500, upsertErr.message);
    }

    // Also update sitedata.seo inside portfolios table for instant viewer consistency
    const nextSiteData = { ...(portfolio.sitedata || {}) };
    nextSiteData.seo = {
      ...(nextSiteData.seo || {}),
      title: cleanTitle,
      description: cleanDesc,
      keywords: cleanKeywords,
      googleVerificationCode: cleanToken || nextSiteData.seo?.googleVerificationCode || "",
    };

    await supabase
      .from("portfolios")
      .update({
        sitedata: nextSiteData,
        name: cleanTitle || portfolio.name,
        description: cleanDesc || portfolio.description,
        updated_at: new Date().toISOString(),
      })
      .eq("id", portfolioId);

    return this.getSeo(portfolioId, userId);
  }

  // 3. Save OAuth connection tokens
  async saveGoogleConnection(portfolioId, userId, { tokens, profile }) {
    const portfolio = await this.assertOwner(portfolioId, userId);

    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const siteUrl = activeDomain ? fullUrl(activeDomain) : null;

    let verificationToken = "";
    if (siteUrl && tokens) {
      try {
        const tokenRes = await googleSearchConsoleService.getVerificationToken(tokens, siteUrl);
        verificationToken = tokenRes?.token || "";
      } catch (err) {
        console.warn("[SeoService] getVerificationToken warning:", err.message);
      }
    }

    const existing = await this.getRow(portfolioId);
    const insp = { ...(existing?.inspection_result || {}) };

    const patch = {
      portfolio_id: portfolioId,
      google_tokens: tokens,
      google_account_email: profile?.email || null,
      updated_at: new Date().toISOString(),
    };

    if (verificationToken) {
      patch.google_verification_token = verificationToken;
    }

    const { error } = await supabase
      .from("portfolio_seo")
      .upsert(patch, { onConflict: "portfolio_id" });

    if (error) {
      throw httpError(500, error.message);
    }

    return this.getSeo(portfolioId, userId);
  }

  // 4. Disconnect Google Search Console
  async disconnectGoogle(portfolioId, userId) {
    await this.assertOwner(portfolioId, userId);

    const existing = await this.getRow(portfolioId);
    const insp = { ...(existing?.inspection_result || {}) };
    delete insp.sitemapStatus;
    delete insp.sitemapErrorDetails;

    const { error } = await supabase
      .from("portfolio_seo")
      .update({
        google_tokens: null,
        google_account_email: null,
        google_verified: false,
        sitemap_submitted: false,
        is_indexed: false,
        inspection_result: insp,
        updated_at: new Date().toISOString(),
      })
      .eq("portfolio_id", portfolioId);

    if (error) {
      throw httpError(500, error.message);
    }

    return this.getSeo(portfolioId, userId);
  }

  // 5. Verify ownership
  async verifyOwnership(portfolioId, userId) {
    const portfolio = await this.assertOwner(portfolioId, userId);
    const seoRow = await this.getRow(portfolioId);

    if (!seoRow?.google_tokens) {
      throw httpError(400, "Google Search Console is not connected yet.");
    }

    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const siteUrl = activeDomain ? fullUrl(activeDomain) : null;

    if (!siteUrl) {
      throw httpError(400, "Please deploy your portfolio first before verifying ownership.");
    }

    const insp = { ...(seoRow?.inspection_result || {}) };

    try {
      await googleSearchConsoleService.verifyOwnership(seoRow.google_tokens, siteUrl);
      delete insp.verificationError;

      await supabase
        .from("portfolio_seo")
        .update({
          google_verified: true,
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      const freshSeo = await this.getSeo(portfolioId, userId);
      return { success: true, verified: true, seo: freshSeo };
    } catch (err) {
      console.error("[SeoService] verifyOwnership error:", err.message);
      insp.verificationError = err.message || "Google could not verify the meta tag on your live website.";

      await supabase
        .from("portfolio_seo")
        .update({
          google_verified: false,
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      throw httpError(400, insp.verificationError);
    }
  }

  // 6. Submit Sitemap
  async submitSitemap(portfolioId, userId, explicitSitemapUrl) {
    const portfolio = await this.assertOwner(portfolioId, userId);
    const seoRow = await this.getRow(portfolioId);

    if (!seoRow?.google_tokens) {
      throw httpError(400, "Google Search Console is not connected.");
    }

    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const siteUrl = activeDomain ? fullUrl(activeDomain) : null;

    const sitemapUrl = explicitSitemapUrl || (siteUrl ? `${siteUrl}/sitemap.xml` : null);

    if (!siteUrl || !sitemapUrl) {
      throw httpError(400, "Portfolio must be deployed to submit a sitemap.");
    }

    const insp = { ...(seoRow?.inspection_result || {}) };

    try {
      await googleSearchConsoleService.submitSitemap(seoRow.google_tokens, siteUrl, sitemapUrl);

      insp.sitemapStatus = "SUCCESS";
      insp.sitemapSubmittedAt = new Date().toISOString();
      delete insp.sitemapErrorDetails;
      insp.sitemapErrors = 0;

      await supabase
        .from("portfolio_seo")
        .update({
          sitemap_submitted: true,
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      const freshSeo = await this.getSeo(portfolioId, userId);
      return { success: true, submitted: true, seo: freshSeo };
    } catch (err) {
      console.error("[SeoService] submitSitemap error:", err.message);
      insp.sitemapStatus = "ERROR";
      insp.sitemapErrorDetails = err.message;
      insp.sitemapErrors = 1;

      await supabase
        .from("portfolio_seo")
        .update({
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      throw httpError(500, err.message || "Failed to submit sitemap to Google Search Console");
    }
  }

  // 7. Check Sitemap processing status
  async checkSitemap(portfolioId, userId, explicitSitemapUrl) {
    const portfolio = await this.assertOwner(portfolioId, userId);
    const seoRow = await this.getRow(portfolioId);

    if (!seoRow?.google_tokens) {
      throw httpError(400, "Google Search Console is not connected.");
    }

    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const siteUrl = activeDomain ? fullUrl(activeDomain) : null;
    const sitemapUrl = explicitSitemapUrl || (siteUrl ? `${siteUrl}/sitemap.xml` : null);

    const statusRes = await googleSearchConsoleService.getSitemapStatus(
      seoRow.google_tokens,
      siteUrl,
      sitemapUrl
    );

    const insp = { ...(seoRow?.inspection_result || {}) };
    insp.sitemapStatus = statusRes.status;
    insp.sitemapErrors = statusRes.errors || 0;
    insp.sitemapWarnings = statusRes.warnings || 0;
    insp.sitemapLastDownloaded = statusRes.lastDownloaded || null;
    insp.sitemapErrorDetails = statusRes.errorDetails || null;

    await supabase
      .from("portfolio_seo")
      .update({
        inspection_result: insp,
        updated_at: new Date().toISOString(),
      })
      .eq("portfolio_id", portfolioId);

    const freshSeo = await this.getSeo(portfolioId, userId);
    return { success: true, sitemapStatus: statusRes, seo: freshSeo };
  }

  // 8. Inspect URL indexing
  async inspectUrl(portfolioId, userId, explicitTargetUrl) {
    const portfolio = await this.assertOwner(portfolioId, userId);
    const seoRow = await this.getRow(portfolioId);

    if (!seoRow?.google_tokens) {
      throw httpError(400, "Google Search Console is not connected.");
    }

    const isDomainVerified = Boolean(portfolio?.domain_verified);
    const customDom = portfolio?.customdomain && String(portfolio.customdomain).trim();
    const liveRaw = portfolio?.liveurl || "";
    const activeDomain = isDomainVerified && customDom ? customDom : liveRaw;
    const siteUrl = activeDomain ? fullUrl(activeDomain) : null;
    const targetUrl = explicitTargetUrl || siteUrl;

    const insp = { ...(seoRow?.inspection_result || {}) };

    try {
      const inspectRes = await googleSearchConsoleService.inspectUrl(
        seoRow.google_tokens,
        siteUrl,
        targetUrl
      );

      const r = inspectRes.inspectionResult || {};
      const verdict = r.verdict;
      const coverage = (r.coverageState || "").toLowerCase();
      const isIndexed = verdict === "PASS" || (coverage.includes("indexed") && !coverage.includes("not indexed"));

      insp.verdict = verdict;
      insp.coverageState = r.coverageState;
      insp.indexingStatus = isIndexed ? "INDEXED" : "DISCOVERED";
      insp.lastCrawlTime = r.lastCrawlTime;
      insp.pageIndexingReportStatus = "Processing data, please check again in a day or so";
      insp.indexStatusResult = r;
      insp.lastInspectedAt = new Date().toISOString();
      delete insp.inspectionError;

      await supabase
        .from("portfolio_seo")
        .update({
          is_indexed: isIndexed,
          last_crawled_at: r.lastCrawlTime || null,
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      const freshSeo = await this.getSeo(portfolioId, userId);
      return {
        success: true,
        indexingStatus: isIndexed ? "INDEXED" : "DISCOVERED",
        inspectionResult: r,
        seo: freshSeo,
      };
    } catch (err) {
      console.warn("[SeoService] inspectUrl notice:", err.message);
      insp.inspectionError = err.message;
      insp.indexingStatus = "UNABLE_TO_CHECK";

      await supabase
        .from("portfolio_seo")
        .update({
          inspection_result: insp,
          updated_at: new Date().toISOString(),
        })
        .eq("portfolio_id", portfolioId);

      const freshSeo = await this.getSeo(portfolioId, userId);
      return {
        success: false,
        error: err.message,
        indexingStatus: "UNABLE_TO_CHECK",
        seo: freshSeo,
      };
    }
  }
}

export const seoService = new SeoService();
export default seoService;