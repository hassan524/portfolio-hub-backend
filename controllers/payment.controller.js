import paddleService from '../services/paddle.service.js';
import { verifyPaddleSignature } from '../utils/paddleSignature.util.js';

// Controller for handling checkout payments and Paddle webhooks
export class PaymentController {
  constructor() {
    this.createPaymentTransaction = this.createPaymentTransaction.bind(this);
    this.handlePaddleWebhook = this.handlePaddleWebhook.bind(this);
  }

  // POST /api/payment/create
  async createPaymentTransaction(req, res) {
    try {
      const userId = req.user.id;
      const transaction = await paddleService.createTransaction(userId);
      return res.status(200).json({ transactionId: transaction.id });
    } catch (err) {
      console.error("Full Error JSON:", JSON.stringify(err, null, 2));
      return res.status(500).json({ error: 'Could not start payment' });
    }
  }

  // POST /api/payment/webhook
  async handlePaddleWebhook(req, res) {
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

        await paddleService.markUserAsPaid(userId);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('Webhook processing failed:', err.message);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }
}

export const paymentController = new PaymentController();
export default paymentController;