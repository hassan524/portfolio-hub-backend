import { supabase } from "../config/db.js";
import { slugifyProjectName, sleep } from "../utils/string.util.js";

const VERCEL_API_BASE_URL = 'https://api.vercel.com';

// Service for interacting with Vercel API (OAuth, Deployments, History)
export class VercelService {
  // Create Vercel OAuth authorization URL
  createVercelAuthorizationUrl(state) {
    const integrationSlug = process.env.VERCEL_INTEGRATION_SLUG;
    if (!integrationSlug) {
      throw new Error('VERCEL_INTEGRATION_SLUG is not configured');
    }

    const authorizationUrl = new URL(`https://vercel.com/integrations/${integrationSlug}/new`);
    authorizationUrl.searchParams.set('state', state);

    return authorizationUrl.toString();
  }

  // Exchange OAuth code for Vercel access token
  async exchangeVercelAuthorizationCode(code) {
    if (!code) {
      throw new Error('Missing authorization code');
    }

    const requestBody = new URLSearchParams({
      code,
      client_id: process.env.VERCEL_CLIENT_ID,
      client_secret: process.env.VERCEL_CLIENT_SECRET,
      redirect_uri: process.env.VERCEL_REDIRECT_URI,
    });

    const response = await fetch(`${VERCEL_API_BASE_URL}/v2/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: requestBody,
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[vercel.service] token exchange failed, raw response:', JSON.stringify(responseData, null, 2));
      const errorMessage =
        typeof responseData?.error === 'string'
          ? responseData.error
          : responseData?.error?.message || responseData?.error_description || 'Failed to exchange Vercel code';
      throw new Error(errorMessage);
    }

    if (!responseData.access_token) {
      throw new Error('Vercel did not return an access token');
    }

    return responseData.access_token;
  }

  // Poll Vercel deployment status until finished (READY, ERROR, CANCELED)
  async waitForDeploymentReady(accessToken, deploymentId, teamId, {
    intervalMs = 2000,
    timeoutMs = 90000,
  } = {}) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const readyState = await this.getVercelDeploymentStatus(accessToken, deploymentId, teamId);

      if (readyState === "READY") return readyState;
      if (readyState === "ERROR" || readyState === "CANCELED") {
        throw new Error(`Vercel deployment ended with state: ${readyState}`);
      }

      await sleep(intervalMs);
    }

    throw new Error("Timed out waiting for Vercel deployment to become ready");
  }

  // Deploy React/Vite project files to Vercel and update portfolio record
  async deployReactProjectToVercel(accessToken, projectName, fileMap, teamId, portfolioId) {
    const files = Object.entries(fileMap).map(([path, content]) => ({
      file: path,
      data: Buffer.from(content, "utf-8").toString("base64"),
      encoding: "base64",
    }));

    const url = new URL(`${VERCEL_API_BASE_URL}/v13/deployments`);
    if (teamId) {
      url.searchParams.set("teamId", teamId);
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        target: "production",
        files,
        projectSettings: {
          framework: "vite",
          buildCommand: "npm run build",
          outputDirectory: "dist",
          installCommand: "npm install",
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[vercel.service] deploy failed:", JSON.stringify(data));
      throw new Error(data?.error?.message || "Vercel deployment failed");
    }

    try {
      await this.waitForDeploymentReady(accessToken, data.id, teamId);
    } catch (err) {
      console.error("[vercel.service] deployment did not become ready:", err.message);
      throw err;
    }

    let productionUrl = null;
    for (let attempt = 0; attempt < 5 && !productionUrl; attempt++) {
      productionUrl = await this.getVercelProjectProductionDomain(accessToken, projectName, teamId);
      if (!productionUrl) await sleep(1500);
    }

    const liveUrl = productionUrl || `https://${data.url}`;

    const { data: updatedRows, error: updateError } = await supabase
      .from("portfolios")
      .update({
        isdeployed: true,
        isdraft: false,
        liveurl: liveUrl,
        updated_at: new Date().toISOString(),
        hosting: "vercel",
      })
      .eq("id", portfolioId)
      .select();

    if (updateError) {
      console.error("[portfolio] failed to update deployment status:", updateError);
      throw new Error("Deployment succeeded, but failed to update portfolio");
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error("[portfolio] no portfolio matched id:", portfolioId);
      throw new Error(`Deployment succeeded, but no portfolio found with id ${portfolioId}`);
    }

    return {
      deploymentId: data.id,
      url: liveUrl,
    };
  }

  // Fetch production domain alias for a Vercel project
  async getVercelProjectProductionDomain(accessToken, projectName, teamId) {
    const url = new URL(`${VERCEL_API_BASE_URL}/v9/projects/${encodeURIComponent(projectName)}`);
    if (teamId) url.searchParams.set('teamId', teamId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;

    const aliases = data?.targets?.production?.alias || data?.alias || [];
    if (!aliases.length) return null;

    const cleanAlias = aliases.find((a) => a === `${projectName}.vercel.app`);
    const chosen = cleanAlias || aliases.sort((a, b) => a.length - b.length)[0];

    return chosen ? `https://${chosen}` : null;
  }

  // Get state of a specific Vercel deployment
  async getVercelDeploymentStatus(accessToken, deploymentId, teamId) {
    const url = new URL(`${VERCEL_API_BASE_URL}/v13/deployments/${deploymentId}`);
    if (teamId) url.searchParams.set('teamId', teamId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || 'Failed to fetch deployment status');
    return data.readyState;
  }

  // Get recent deployment history for a project
  async getVercelDeploymentHistory(accessToken, projectName, teamId, limit = 10) {
    const url = new URL(`${VERCEL_API_BASE_URL}/v6/deployments`);
    url.searchParams.set("app", projectName);
    url.searchParams.set("limit", String(limit));
    if (teamId) url.searchParams.set("teamId", teamId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || "Failed to fetch Vercel deployment history");
    }

    const mapState = (state) => {
      switch (state) {
        case "READY": return "success";
        case "ERROR": return "failed";
        case "CANCELED": return "canceled";
        case "BUILDING":
        case "QUEUED":
        case "INITIALIZING":
          return "building";
        default: return "unknown";
      }
    };

    return (data.deployments || []).map((d) => ({
      id: d.uid,
      status: mapState(d.state || d.readyState),
      message: d.meta?.githubCommitMessage || d.meta?.gitCommitMessage || d.meta?.message || null,
      url: d.url ? `https://${d.url}` : null,
      createdAt: d.created ? new Date(d.created).toISOString() : null,
    }));
  }
}

export const vercelService = new VercelService();
export default vercelService;