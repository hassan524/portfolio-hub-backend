import { Router } from "express";
import domainController from "../controllers/domain.controller.js";
import requireAuth from "../middlewares/auth.js";

const router = Router();

router.post("/:portfolioId/domain", requireAuth, domainController.add);
router.get("/:portfolioId/domain", requireAuth, domainController.check);
router.delete("/:portfolioId/domain", requireAuth, domainController.remove);

export default router;