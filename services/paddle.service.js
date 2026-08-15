import paddle from '../config/paddle.js';

const PORTFOLIO_PRICE_ID = process.env.PADDLE_PRICE_ID; 

export async function createTransaction(userId) {
  const transaction = await paddle.transactions.create({
    items: [
      {
        priceId: PORTFOLIO_PRICE_ID,
        quantity: 1,
      },
    ],
    customData: {
      userId: userId, // this is what comes back later in the webhook
    },
  });

  return transaction;
}

