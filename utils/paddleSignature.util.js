import crypto from 'crypto';

/**
 * Verifies Paddle webhook HMAC-SHA256 signature against raw request body.
 *
 * @param {string} rawBody - Raw UTF-8 string of request body.
 * @param {string} signature - Value of 'paddle-signature' header.
 * @param {string} secret - Paddle webhook secret key.
 * @returns {boolean} True if signature is valid, false otherwise.
 */
export function verifyPaddleSignature(rawBody, signature, secret) {
  if (!signature || !rawBody || !secret) {
    return false;
  }

  const parts = signature.split(';');
  const tsPart = parts.find((p) => p.startsWith('ts='));
  const h1Part = parts.find((p) => p.startsWith('h1='));

  if (!tsPart || !h1Part) {
    return false;
  }

  const ts = tsPart.split('=')[1];
  const receivedHash = h1Part.split('=')[1];

  const signedPayload = `${ts}:${rawBody}`;
  const computedHash = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  try {
    const receivedBuf = Buffer.from(receivedHash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');
    if (receivedBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(receivedBuf, computedBuf);
  } catch {
    return false;
  }
}
