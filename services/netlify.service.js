import JSZip from 'jszip';

const NETLIFY_API_BASE_URL = 'https://api.netlify.com/api/v1';
const NETLIFY_AUTHORIZE_URL = 'https://app.netlify.com/authorize';
const NETLIFY_TOKEN_URL = 'https://api.netlify.com/oauth/token';

// Service for interacting with Netlify API (OAuth, Site creation, ZIP deployments)
export class NetlifyService {
  // Create Netlify OAuth authorization URL
  createNetlifyAuthorizationUrl(state) {
    const authorizationUrl = new URL(NETLIFY_AUTHORIZE_URL);

    authorizationUrl.searchParams.set('client_id', process.env.NETLIFY_CLIENT_ID);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', process.env.NETLIFY_REDIRECT_URI);
    authorizationUrl.searchParams.set('state', state);

    return authorizationUrl.toString();
  }

  // Exchange OAuth authorization code for Netlify access token
  async exchangeNetlifyAuthorizationCode(code) {
    if (!code) {
      throw new Error('Missing authorization code');
    }

    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.NETLIFY_CLIENT_ID,
      client_secret: process.env.NETLIFY_CLIENT_SECRET,
      redirect_uri: process.env.NETLIFY_REDIRECT_URI,
    });

    const response = await fetch(NETLIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: requestBody,
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[netlify.service] token exchange failed, raw response:', JSON.stringify(responseData, null, 2));
      const errorMessage = responseData?.error_description || responseData?.error || 'Failed to exchange Netlify code';
      throw new Error(errorMessage);
    }

    if (!responseData.access_token) {
      throw new Error('Netlify did not return an access token');
    }

    return responseData.access_token;
  }

  async deployHtmlToNetlify(accessToken, siteName, htmlContent, files = null) {
    const siteRes = await fetch(`${NETLIFY_API_BASE_URL}/sites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: siteName }),
    });
    const site = await siteRes.json().catch(() => ({}));
    if (!siteRes.ok) {
      console.error('[netlify.service] site creation failed:', JSON.stringify(site));
      throw new Error(site?.message || 'Failed to create Netlify site');
    }

    const zip = new JSZip();
    if (files && typeof files === 'object' && Object.keys(files).length > 0) {
      for (const [filePath, content] of Object.entries(files)) {
        if (typeof content === "string" && content.startsWith("data:") && content.includes(";base64,")) {
          zip.file(filePath, Buffer.from(content.split(";base64,")[1], "base64"));
        } else if (typeof content === "string" && content.startsWith("base64:")) {
          zip.file(filePath, Buffer.from(content.slice(7), "base64"));
        } else {
          zip.file(filePath, content);
        }
      }
    } else {
      zip.file('index.html', htmlContent || '');
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    const deployRes = await fetch(`${NETLIFY_API_BASE_URL}/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/zip',
      },
      body: zipBuffer,
    });
    const deploy = await deployRes.json().catch(() => ({}));
    if (!deployRes.ok) {
      console.error('[netlify.service] deploy failed:', JSON.stringify(deploy));
      throw new Error(deploy?.message || 'Netlify deployment failed');
    }

    return { siteId: site.id, deployId: deploy.id, url: site.ssl_url || site.url };
  }

  // Get status of a Netlify deployment
  async getNetlifyDeployStatus(accessToken, siteId, deployId) {
    const response = await fetch(`${NETLIFY_API_BASE_URL}/sites/${siteId}/deploys/${deployId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || 'Failed to fetch deploy status');
    return data.state;
  }
}

export const netlifyService = new NetlifyService();
export default netlifyService;