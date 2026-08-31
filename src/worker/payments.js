import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';

export const getOpenseaCollectionOwner = async (chain, contractAddress, tokenId, env) => {
  let formattedChain = chain.toLowerCase();
  if (formattedChain.includes('eth')) formattedChain = 'ethereum';
  else if (formattedChain.includes('base')) formattedChain = 'base';
  else if (formattedChain.includes('polygon') || formattedChain.includes('matic')) formattedChain = 'polygon';
  else if (formattedChain.includes('arb')) formattedChain = 'arbitrum';
  else if (formattedChain.includes('opt')) formattedChain = 'optimism';
  else if (formattedChain.includes('zora')) formattedChain = 'zora';
  else if (formattedChain.includes('blast')) formattedChain = 'blast';
  else if (formattedChain.includes('avax') || formattedChain.includes('avalanche')) formattedChain = 'avalanche';

  try {
    const openseaRes = await fetch(`https://api.opensea.io/api/v2/chain/${formattedChain}/contract/${contractAddress}/nfts/${tokenId}/collection`, {
      headers: {
        accept: '*/*',
        'x-api-key': env.OPENSEA_API_KEY
      }
    });
    if (openseaRes.ok) {
      const openseaData = await openseaRes.json();
      return openseaData.owner;
    } else {
      console.error('OpenSea API error:', await openseaRes.text());
      return null;
    }
  } catch (err) {
    console.error('Failed to fetch from OpenSea:', err);
    return null;
  }
};

export const getNftHolder = async (chain, contractAddress, tokenId, env) => {
  let network = Network.ETH_MAINNET;
  const formattedChain = chain.toLowerCase();
  
  if (formattedChain.includes('base')) network = Network.BASE_MAINNET;
  else if (formattedChain.includes('polygon') || formattedChain.includes('matic')) network = Network.MATIC_MAINNET;
  else if (formattedChain.includes('arb')) network = Network.ARB_MAINNET;
  else if (formattedChain.includes('opt')) network = Network.OPT_MAINNET;
  else if (formattedChain.includes('avax')) network = Network.AVAX_MAINNET;
  else if (formattedChain.includes('zora')) network = Network.ZORA_MAINNET;
  else if (formattedChain.includes('blast')) network = Network.BLAST_MAINNET;

  try {
    const alchemy = new Alchemy({
      apiKey: env.ALCHEMY_API_KEY,
      network: network
    });
    const ownersData = await alchemy.nft.getOwnersForNft(contractAddress, tokenId);
    return ownersData.owners?.[0] || null;
  } catch (err) {
    console.error('Failed to fetch NFT holder from Alchemy SDK:', err);
  }
  return null;
};

export const payCreator = async (key, env, emit) => {
  const [chain, contractAddress, tokenId] = key.split(':');
  
  const [creatorAddress, holderAddress] = await Promise.all([
    getOpenseaCollectionOwner(chain, contractAddress, tokenId, env),
    getNftHolder(chain, contractAddress, tokenId, env)
  ]);

  if (env.PRIVATE_KEY && env.X402_TOKEN_ADDRESS && (creatorAddress || holderAddress)) {
    try {
      await emit('phase', { phase: 'paying', message: 'paying asset creator and owner' });
      const isTestnet = false;
      const rpcUrl = isTestnet ?
        `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}` : `https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
      
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
      
      const tokenAddress = isTestnet ? env.X402_TEST_TOKEN_ADDRESS : env.X402_TOKEN_ADDRESS;
      const tokenContract = new ethers.Contract(
        tokenAddress, 
        ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"], 
        wallet
      );
      
      const decimals = await tokenContract.decimals();
      const amount = ethers.parseUnits('1', decimals);

      const normalizeAddress = (addr) => addr ? addr.toLowerCase() : null;

      const sendWithRetry = async (targetAddress, sendAmount) => {
        let attempts = 0;
        while (attempts < 5) {
          try {
            const tx = await tokenContract.transfer(targetAddress, sendAmount);
            return tx;
          } catch (err) {
            if (err.code === 'REPLACEMENT_UNDERPRICED' || err.code === 'NONCE_EXPIRED' || (err.message && err.message.includes('nonce'))) {
              attempts++;
              const delay = 500 + Math.random() * 1000;
              await new Promise(r => setTimeout(r, delay));
            } else {
              throw err;
            }
          }
        }
        throw new Error('Failed to send transaction after 5 attempts due to nonce collisions');
      };

      const transactions = [];

      if (creatorAddress && holderAddress && normalizeAddress(creatorAddress) === normalizeAddress(holderAddress)) {
        // If creator and holder are the same person, batch into a single transfer to save gas
        const tx = await sendWithRetry(creatorAddress, ethers.parseUnits('2', decimals));
        transactions.push(tx);
      } else {
        // Otherwise, send sequentially, each with its own retry loop to prevent double payments
        if (creatorAddress) {
          const tx = await sendWithRetry(creatorAddress, amount);
          transactions.push(tx);
        }
        if (holderAddress) {
          const tx = await sendWithRetry(holderAddress, amount);
          transactions.push(tx);
        }
      }

      if (transactions.length > 0) {
        await Promise.all(transactions.map(tx => tx.wait()));
        const hashStr = transactions.map(tx => tx.hash).join(',');
        await emit('phase', { phase: 'paid', message: hashStr });
      }
    } catch (e) {
      console.error('Payment failed:', e);
    }
  }
};
