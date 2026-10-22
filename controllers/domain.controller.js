import domainService from "../services/domain.service.js";

export class DomainController {
  constructor() {
    this.add = this.add.bind(this);
    this.check = this.check.bind(this);
    this.remove = this.remove.bind(this);
  }

  async add(req, res) {
    try {
      const { portfolioId } = req.params;
      const { domain } = req.body || {};
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });
      if (!portfolioId) return res.status(400).json({ success: false, message: "Portfolio id is required" });
      if (!domain || typeof domain !== "string") return res.status(400).json({ success: false, message: "Domain is required" });
      const result = await domainService.addDomain(portfolioId, userId, domain);
      return res.status(201).json({ success: true, domain: result });
    } catch (e) {
      return res.status(e.status || 500).json({ success: false, message: e.message || "Failed to add domain" });
    }
  }

  async check(req, res) {
    try {
      const { portfolioId } = req.params;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });
      if (!portfolioId) return res.status(400).json({ success: false, message: "Portfolio id is required" });
      const result = await domainService.checkDomain(portfolioId, userId);
      return res.status(200).json({ success: true, domain: result });
    } catch (e) {
      return res.status(e.status || 500).json({ success: false, message: e.message || "Failed to check domain" });
    }
  }

  async remove(req, res) {
    try {
      const { portfolioId } = req.params;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });
      if (!portfolioId) return res.status(400).json({ success: false, message: "Portfolio id is required" });
      await domainService.removeDomain(portfolioId, userId);
      return res.status(200).json({ success: true, domain: null });
    } catch (e) {
      return res.status(e.status || 500).json({ success: false, message: e.message || "Failed to remove domain" });
    }
  }
}

export const domainController = new DomainController();
export default domainController;