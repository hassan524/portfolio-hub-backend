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