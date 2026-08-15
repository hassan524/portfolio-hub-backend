import { Paddle, EventName } from '@paddle/paddle-node-sdk'
import crypto from 'crypto';
import paddle from '../config/paddle.js';
import { createTransaction } from '../services/paddle.service.js';
import { supabase } from '../config/db.js';

// Called by React when the user clicks "Pay $5"
export async function createPaymentTransaction(req, res) {
    try {
        const userId = req.user.id;
        const transaction = await createTransaction(userId);
        return res.status(200).json({ transactionId: transaction.id });
    } catch (err) {
        console.error("Full Error JSON:", JSON.stringify(err, null, 2));
        return res.status(500).json({ error: 'Could not start payment' });
    }
}

// Manual signature verification — bypasses the SDK's broken unmarshal()
function verifyPaddleSignature(rawBody, signature, secret) {
    const parts = signature.split(';');
    const tsPart = parts.find(p => p.startsWith('ts='));
    const h1Part = parts.find(p => p.startsWith('h1='));
    if (!tsPart || !h1Part) return false;

    const ts = tsPart.split('=')[1];
    const receivedHash = h1Part.split('=')[1];

    const signedPayload = `${ts}:${rawBody}`;
    const computedHash = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

    return receivedHash === computedHash;
}

// Called by Paddle's servers directly — never by React
export async function handlePaddleWebhook(req, res) {
    const signature = req.headers['paddle-signature'];
    const rawBody = req.rawBody;

    if (!signature || !rawBody) {
        return res.status(400).json({ error: 'Missing signature or body' });
    }

    const isValid = verifyPaddleSignature(rawBody, signature, process.env.PADDLE_WEBHOOK_SECRET);

    if (!isValid) {
        console.error('Webhook signature verification failed (manual check)');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    try {
        const eventData = JSON.parse(rawBody);

        if (eventData.event_type === 'transaction.completed') {
            const userId = eventData.data?.custom_data?.userId;

            if (!userId) {
                console.error('Webhook received with no userId in custom_data');
                return res.status(400).json({ error: 'Missing userId in custom_data' });
            }

            const { error } = await supabase
                .from('profiles')
                .update({ is_paid: true })
                .eq('id', userId);

            if (error) {
                console.error('Failed to update is_paid in Supabase:', error);
                return res.status(500).json({ error: 'Database update failed' });
            }
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('Webhook processing failed:', err.message);
        return res.status(500).json({ error: 'Processing failed' });
    }
}