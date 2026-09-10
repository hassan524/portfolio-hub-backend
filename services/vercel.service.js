import { supabase } from "../config/db.js";

const VERCEL_API_BASE_URL = 'https://api.vercel.com';

export function createVercelAuthorizationUrl(state) {
  const integrationSlug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!integrationSlug) {
    throw new Error('VERCEL_INTEGRATION_SLUG is not configured');
  }

  const authorizationUrl = new URL(`https://vercel.com/integrations/${integrationSlug}/new`);
  authorizationUrl.searchParams.set('state', state);

  return authorizationUrl.toString();
}

export async function exchangeVercelAuthorizationCode(code) {
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

export function slugifyProjectName(rawName) {
  const slug = (rawName || 'portfolio')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

  return slug || 'portfolio';
}


export async function deployReactProjectToVercel(
  accessToken,
  projectName,
  fileMap,
  teamId,
  portfolioId
) {

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
    console.error(
      "[vercel.service] deploy failed:",
      JSON.stringify(data)
    );

    throw new Error(
      data?.error?.message || "Vercel deployment failed"
    );
  }

  // Get production URL after successful deployment
  const productionUrl =
    await getVercelProjectProductionDomain(
      accessToken,
      projectName,
      teamId
    );

  const liveUrl =
    productionUrl || `https://${data.url}`;

  const { data: updatedRows, error: updateError } = await supabase
    .from("portfolios")
    .update({
      isdeployed: true,
      isdraft: false,
      liveurl: liveUrl,
      updated_at: new Date().toISOString(),
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

  if (updateError) {
    console.error(
      "[portfolio] failed to update deployment status:",
      updateError
    );

    throw new Error(
      "Deployment succeeded, but failed to update portfolio"
    );
  }

  return {
    deploymentId: data.id,
    url: liveUrl,
  };
}



export async function getVercelProjectProductionDomain(accessToken, projectName, teamId) {
  const url = new URL(`${VERCEL_API_BASE_URL}/v9/projects/${encodeURIComponent(projectName)}`);
  if (teamId) url.searchParams.set('teamId', teamId);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;

  const aliases = data?.targets?.production?.alias || data?.alias || [];
  if (!aliases.length) return null;

  // Prefer the clean "<projectName>.vercel.app" alias over team-scoped
  // ones like "<projectName>-<team>-projects.vercel.app"
  const cleanAlias = aliases.find((a) => a === `${projectName}.vercel.app`);

  const chosen = cleanAlias || aliases.sort((a, b) => a.length - b.length)[0];

  return chosen ? `https://${chosen}` : null;
}

export async function getVercelDeploymentStatus(accessToken, deploymentId, teamId) {
  const url = new URL(`${VERCEL_API_BASE_URL}/v13/deployments/${deploymentId}`);
  if (teamId) url.searchParams.set('teamId', teamId);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Failed to fetch deployment status');
  return data.readyState;
}