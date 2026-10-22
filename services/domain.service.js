import { supabase } from "../config/db.js";
import vercelService from "./vercel.service.js";
import portfolioService from "./portfolio.service.js";

const FALLBACK_IP = "76.76.21.21";
const FALLBACK_CNAME = "cname.vercel-dns.com";
const CLEARED = { customdomain: null, iscustomdomain: false, domain_verified: false };

const fail = (message, status = 500) => Object.assign(new Error(message), { status });
const cleanDomain = (v) => String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
const isValidDomain = (d) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) && !d.endsWith(".vercel.app");
const saveDomain = (id, fields) => supabase.from("portfolios").update(fields).eq("id", id);
const topPick = (list) => [...(list || [])].sort((a, b) => a.rank - b.rank)[0]?.value;

export class DomainService {
  async addDomain(portfolioId, userId, input) {
    const domain = cleanDomain(input);
    if (!isValidDomain(domain)) throw fail("Enter a valid domain like example.com", 400);
    const { portfolio, token, projectName } = await portfolioService.getPortfolioDeployInfo(portfolioId, userId);
    if (portfolio.customdomain) throw fail("Remove the current domain first.", 409);
    const { data: taken } = await supabase.from("portfolios").select("id").eq("customdomain", domain).eq("domain_verified", true).maybeSingle();
    if (taken) throw fail("This domain is already connected to another account.", 409);
    const addPath = `/v10/projects/${projectName}/domains`;
    try {
      await vercelService.callVercel(token, addPath, "POST", { name: domain });
    } catch (e) {
      if (e.status === 409) throw fail("This domain is already attached to another project in your Vercel account.", 409);
      throw e;
    }
    if (domain.split(".").length === 2) {
      try { await vercelService.callVercel(token, addPath, "POST", { name: `www.${domain}`, redirect: domain }); }
      catch (e) { console.error("[domain] www:", e.message); }
    }
    const { error } = await saveDomain(portfolioId, { customdomain: domain, iscustomdomain: true, domain_verified: false });
    if (error) throw fail(error.message);
    return this.checkDomain(portfolioId, userId);
  }

  async checkDomain(portfolioId, userId) {
    const { portfolio, token, projectName } = await portfolioService.getPortfolioDeployInfo(portfolioId, userId);
    const domain = portfolio.customdomain;
    if (!domain) return null;
    const path = `/v9/projects/${projectName}/domains/${domain}`;
    let info = await vercelService.callVercel(token, path);
    if (!info.verified) {
      try { info = { ...info, ...(await vercelService.callVercel(token, `${path}/verify`, "POST")) }; }
      catch (e) { console.error("[domain] verify:", e.message); }
    }
    let cfg = {};
    try { cfg = await vercelService.callVercel(token, `/v6/domains/${domain}/config?projectIdOrName=${projectName}`); }
    catch (e) { console.error("[domain] config:", e.message); }
    const ip = topPick(cfg.recommendedIPv4)?.[0] || FALLBACK_IP;
    const cname = (topPick(cfg.recommendedCNAME) || FALLBACK_CNAME).replace(/\.$/, "");
    const root = info.apexName || domain.split(".").slice(-2).join(".");
    const isApex = domain === root;
    const records = isApex
      ? [{ type: "A", name: "@", value: ip }, { type: "CNAME", name: "www", value: cname }]
      : [{ type: "CNAME", name: domain.slice(0, -(root.length + 1)), value: cname }];
    for (const v of info.verified ? [] : info.verification || []) {
      records.push({ type: v.type, name: v.domain === root ? "@" : v.domain.replace(`.${root}`, ""), value: v.value });
    }
    let status = "pending";
    if (info.verified && cfg.misconfigured === false) status = "connected";
    else if (cfg.misconfigured && (cfg.aValues?.length || cfg.cnames?.length)) status = "invalid";
    const connected = status === "connected";
    if (Boolean(portfolio.domain_verified) !== connected) {
      const { error } = await saveDomain(portfolioId, { domain_verified: connected });
      if (error?.code === "23505") throw fail("This domain is already connected to another account.", 409);
      if (error) throw fail(error.message);
    }
    return { domain, status, dns: records };
  }

  async removeDomain(portfolioId, userId) {
    const { portfolio, token, projectName } = await portfolioService.getPortfolioDeployInfo(portfolioId, userId);
    const domain = portfolio.customdomain;
    if (!domain) return null;
    for (const name of [domain, `www.${domain}`]) {
      try { await vercelService.callVercel(token, `/v9/projects/${projectName}/domains/${name}`, "DELETE"); }
      catch (e) { if (e.status !== 404) console.error("[domain] remove:", name, e.message); }
    }
    const { error } = await saveDomain(portfolioId, CLEARED);
    if (error) throw fail(error.message);
    return null;
  }
}

export const domainService = new DomainService();
export default domainService;