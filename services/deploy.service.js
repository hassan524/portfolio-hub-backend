import { supabase } from "../config/db.js";

const SUPPORTED_PLATFORMS = ['vercel', 'netlify'];

export async function getUserDeployStatus(userId) {
  const { data, error } = await supabase
    .from('deploy_credentials')
    .select('platform')
    .eq('userid', userId);

  if (error) {
    throw new Error(`Failed to fetch deploy status: ${error.message}`);
  }

  const connectedPlatforms = new Set((data || []).map((row) => row.platform));

  return {
    vercel: connectedPlatforms.has('vercel'),
    netlify: connectedPlatforms.has('netlify'),
  };
}

export async function saveDeployCredential(userId, platform, accessToken, teamId = null) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  if (!accessToken) {
    throw new Error('Cannot save an empty access token');
  }

  const { error } = await supabase
    .from('deploy_credentials')
    .upsert(
      { userid: userId, platform, access_token: accessToken, team_id: teamId },
      { onConflict: 'userid,platform' }
    );

  if (error) {
    throw new Error(`Failed to save ${platform} credential: ${error.message}`);
  }
}

export async function getUserDeployCredential(userId, platform) {
  const { data, error } = await supabase
    .from('deploy_credentials')
    .select('access_token, team_id')
    .eq('userid', userId)
    .eq('platform', platform)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch ${platform} credential: ${error.message}`);
  }
  return data ?? null; 
}

export async function checkVercelNameAvailable(userId, name) {
  const res = await fetch(`https://${name}.vercel.app`, {
    method: 'GET',
    redirect: 'manual',
  });

  if (res.status === 404 && res.headers.get('x-vercel-error') === 'DEPLOYMENT_NOT_FOUND') {
    return true;
  }
  return false;
}

export async function checkNetlifyNameAvailable(userId, name) {
  const credential = await getUserDeployCredential(userId, 'netlify');
  if (!credential) {
    throw new Error('Netlify not connected');
  }

  const res = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(name)}.netlify.app`, {
    headers: { Authorization: `Bearer ${credential.access_token}` },
  });

  if (res.status === 404) return true;
  if (res.status === 200) return false;

  throw new Error(`Netlify name check failed with status ${res.status}`);
}
