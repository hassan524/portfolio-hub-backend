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

export async function saveDeployCredential(userId, platform, accessToken) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  if (!accessToken) {
    throw new Error('Cannot save an empty access token');
  }

  const { error } = await supabase
    .from('deploy_credentials')
    .upsert(
      { userid: userId, platform, access_token: accessToken },
      { onConflict: 'userid,platform' }
    );

  if (error) {
    throw new Error(`Failed to save ${platform} credential: ${error.message}`);
  }
}