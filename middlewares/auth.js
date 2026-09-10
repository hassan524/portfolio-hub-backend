import { supabase } from '../config/db.js';

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const queryToken = req.query.token;

  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization' });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  next();
}

export default requireAuth;