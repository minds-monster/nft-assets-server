import { Hono, Context, Next } from 'hono';

export const x402Middleware = (amount: number = 1) => {
  return async (c: Context, next: Next) => {
    const env = c.env as any;
    const txHash = c.req.header('x-402-payment-proof') || c.req.header('x-402-tx-hash');
    
    let isSettled = false;

    // For backwards compatibility during development
    if (c.req.header('x-402-payment-status') === 'settled') {
      isSettled = true;
    } else if (txHash && env.ALCHEMY_API_KEY) {
      try {
        const alchemyUrl = `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
        const response = await fetch(alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash]
          })
        });

        const data = await response.json() as any;
        
        if (data.result && data.result.status === '0x1') {
          // In a production app, verify the event logs for correct amount and recipient
          const expectedToken = env.X402_TEST_TOKEN_ADDRESS || env.X402_TOKEN_ADDRESS;
          if (expectedToken) {
            if (data.result.to && data.result.to.toLowerCase() === expectedToken.toLowerCase()) {
              isSettled = true;
            }
          } else {
            isSettled = true;
          }
        }
      } catch (err) {
        console.error('Failed to verify x402 payment proof:', err);
      }
    }
    
    if (!isSettled) {
      const expectedToken = env.X402_TEST_TOKEN_ADDRESS || env.X402_TOKEN_ADDRESS;
      return c.json({
        error: "Payment Required",
        x402: {
          amount: amount,
          tokenAddress: expectedToken,
          chain: 'base-sepolia',
          recipient: env.X402_WALLET_ADDRESS || '0x0',
          facilitator: env.X402_FACILITATOR_URL || 'https://coinbase-x402-facilitator.com'
        }
      }, 402);
    }
    
    await next();
  };
};
