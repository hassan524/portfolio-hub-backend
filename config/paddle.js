import { Paddle, Environment } from '@paddle/paddle-node-sdk';

if (!process.env.PADDLE_API_KEY) {
  throw new Error('PADDLE_API_KEY is missing from environment variables');
}

const paddle = new Paddle(process.env.PADDLE_API_KEY, {

  environment:
    process.env.PADDLE_ENVIRONMENT === 'production'
      ? Environment.production
      : Environment.sandbox,
});

export default paddle