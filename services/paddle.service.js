import paddle from '../config/paddle.js';
import { supabase } from '../config/db.js';

const PORTFOLIO_PRICE_ID = process.env.PADDLE_PRICE_ID;

// Service for Paddle payment checkout transactions and updating profile payment status
export class PaddleService {
  // Create checkout transaction in Paddle
  async createTransaction(userId) {
    const transaction = await paddle.transactions.create({
      items: [
        {
          priceId: PORTFOLIO_PRICE_ID,
          quantity: 1,
        },
      ],
      customData: {
        userId: userId,
      },
    });

    return transaction;
  }

  // Update profile record in database to mark user as paid
  async markUserAsPaid(userId) {
    const { error } = await supabase
      .from('profiles')
      .update({ is_paid: true })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update is_paid in Supabase:', error);
      throw new Error(`Database update failed: ${error.message}`);
    }

    return true;
  }
}

export const paddleService = new PaddleService();
export default paddleService;
