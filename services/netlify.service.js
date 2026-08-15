const NETLIFY_AUTHORIZE_URL = 'https://app.netlify.com/authorize';
const NETLIFY_TOKEN_URL = 'https://api.netlify.com/oauth/token';


export function createNetlifyAuthorizationUrl(state) {
  const authorizationUrl = new URL(NETLIFY_AUTHORIZE_URL);

  authorizationUrl.searchParams.set('client_id', process.env.NETLIFY_CLIENT_ID);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('redirect_uri', process.env.NETLIFY_REDIRECT_URI);
  authorizationUrl.searchParams.set('state', state);

  return authorizationUrl.toString();
}


export async function exchangeNetlifyAuthorizationCode(code) {
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
    const errorMessage = responseData?.error_description || responseData?.error || 'Failed to exchange Netlify code';
    throw new Error(errorMessage);
  }

  if (!responseData.access_token) {
    throw new Error('Netlify did not return an access token');
  }

  return responseData.access_token;
}