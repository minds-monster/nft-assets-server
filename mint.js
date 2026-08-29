const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function mintTokens() {
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

    if (!env.PRIVATE_KEY || !env.X402_TOKEN_ADDRESS) {
        console.error('Missing PRIVATE_KEY or X402_TOKEN_ADDRESS in environment');
        return;
    }

    try {
        const rpcUrl = env.ALCHEMY_API_KEY 
          ? `https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
          : 'https://mainnet.base.org';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
        
        console.log(`Connected wallet address: ${wallet.address}`);
        console.log(`Token contract: ${env.X402_TOKEN_ADDRESS}`);

        // Assuming a standard mint function: mint(address to, uint256 amount)
        const tokenContract = new ethers.Contract(
          env.X402_TOKEN_ADDRESS, 
          [
            "function mint(address to, uint256 amount) external",
            "function decimals() view returns (uint8)"
          ], 
          wallet
        );
        
        const decimals = await tokenContract.decimals();
        // The user requested 10k tokens
        const amountToMint = ethers.parseUnits('10000', decimals);
        
        console.log(`Minting 10,000 tokens (${amountToMint} base units) to ${wallet.address}...`);
        
        const tx = await tokenContract.mint(wallet.address, amountToMint);
        console.log(`Transaction submitted: ${tx.hash}`);
        console.log('Waiting for confirmation...');
        
        await tx.wait();
        console.log(`Mint successful! Transaction viewable at: https://basescan.org/tx/${tx.hash}`);
    } catch (e) {
        console.error('Minting failed:', e);
    }
}

mintTokens();
