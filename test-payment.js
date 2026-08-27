const { ethers } = require('ethers');
const { Alchemy, Network } = require('alchemy-sdk');
const fs = require('fs');
const path = require('path');

// Mock emit function to log to console instead
async function emit(event, data) {
    console.log(`[EMIT] ${event}:`, data);
}

async function testPayment(contractAddress, tokenId) {
    // Load env vars from .dev.vars
    const env = { ...process.env };
    try {
        const devVarsPath = path.join(__dirname, '.dev.vars');
        if (fs.existsSync(devVarsPath)) {
            const devVars = fs.readFileSync(devVarsPath, 'utf8');
            devVars.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    let val = match[2].trim();
                    if (val.startsWith('"') && val.endsWith('"')) {
                        val = val.slice(1, -1);
                    } else if (val.startsWith("'") && val.endsWith("'")) {
                        val = val.slice(1, -1);
                    }
                    if (!env[key]) env[key] = val;
                }
            });
            console.log('Loaded environment variables from .dev.vars');
        }
    } catch (e) {
        console.warn('Could not load .dev.vars', e.message);
    }

    if (!env.ALCHEMY_API_KEY) {
        console.error('ALCHEMY_API_KEY is missing from environment');
        return;
    }

    // Initialize Alchemy to fetch NFT metadata
    console.log(`Fetching NFT metadata for contract ${contractAddress} and token ${tokenId}...`);
    const alchemy = new Alchemy({
        apiKey: env.ALCHEMY_API_KEY,
        network: Network.ETH_MAINNET, // Assuming the NFT is on Mainnet, as per src/alchemy.ts
    });

    let ownerAddress;
    try {
        const nft = await alchemy.nft.getNftMetadata(contractAddress, tokenId);
        console.log(`NFT Name: ${nft.name || nft.title || 'Unknown'}`);
        
        const ownersRes = await alchemy.nft.getOwnersForNft(contractAddress, tokenId);
        if (ownersRes.owners && ownersRes.owners.length > 0) {
            ownerAddress = ownersRes.owners[0];
            console.log(`Actual Owner(s) found: ${ownersRes.owners.length}. Using first owner: ${ownerAddress}`);
        } else {
            ownerAddress = nft?.contract?.contractDeployer || nft?.contract?.deployerAddress;
            console.log(`No direct owner found. Fallback to Contract Deployer: ${ownerAddress}`);
        }
        
        if (!ownerAddress) {
            console.error('Could not determine an owner or deployer address for this NFT.');
            return;
        }
    } catch (e) {
        console.error('Failed to fetch NFT from Alchemy:', e.message);
        return;
    }

    // Process payment using the ownerAddress
    if (ownerAddress && env.PRIVATE_KEY && env.X402_TOKEN_ADDRESS) {
      try {
        await emit('phase', { phase: 'paying', message: 'paying NFT owner' });
        const rpcUrl = env.ALCHEMY_API_KEY 
          ? `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
          : 'https://sepolia.base.org';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
        
        console.log(`Connected wallet address: ${wallet.address}`);
        console.log(`Token contract: ${env.X402_TOKEN_ADDRESS}`);

        const tokenContract = new ethers.Contract(
          env.X402_TOKEN_ADDRESS, 
          ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"], 
          wallet
        );
        
        const decimals = await tokenContract.decimals();
        const amountToTransfer = ethers.parseUnits('1', decimals);
        console.log(`Transferring 1 token (${amountToTransfer} base units) to ${ownerAddress}...`);
        
        const tx = await tokenContract.transfer(ownerAddress, amountToTransfer);
        console.log(`Transaction submitted: ${tx.hash}`);
        console.log('Waiting for confirmation...');
        
        await tx.wait();
        await emit('phase', { phase: 'paid', message: `https://sepolia.basescan.org/tx/${tx.hash}` });
        console.log('Payment successful!');
      } catch (e) {
        console.error('Payment failed:', e);
        await emit('phase', { phase: 'payfailed', message: `tx failed: ${e.message}` });
      }
    } else {
        console.error('Missing required environment variables for payment:');
        console.log({
            hasPrivateKey: !!env.PRIVATE_KEY,
            hasTokenAddress: !!env.X402_TOKEN_ADDRESS
        });
    }
}

// Run the function
const contractAddress = process.argv[2]; 
const tokenId = process.argv[3];

if (!contractAddress || !tokenId) {
    console.error('Please provide a contract address and token ID.');
    console.error('Usage: node test-payment.js <contractAddress> <tokenId>');
    process.exit(1);
}

testPayment(contractAddress, tokenId);
