import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Load dev variables for our own script if needed
dotenv.config({ path: '.dev.vars' });

async function main() {
  const targetUrl = 'http://localhost:8787/r2/ethereum/0xf1083e064f92db0561fd540f982cbf73a4e2f8f6/2/thumbnail.png';

  console.log(`[1] Requesting ${targetUrl} (Expected 402)...`);
  const initialRes = await fetch(targetUrl);
  
  if (initialRes.status !== 402) {
    console.error(`Expected 402 status, got ${initialRes.status}`);
    console.log(await initialRes.text());
    return;
  }

  const x402Data = await initialRes.json();
  console.log('\n[2] Received 402 Response:');
  console.log(JSON.stringify(x402Data, null, 2));

  const { amount, tokenAddress, recipient, chain } = x402Data.x402;
  
  if (chain !== 'base-sepolia') {
    throw new Error(`Expected chain base-sepolia, got ${chain}`);
  }

  // Check for private key
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('\n⚠️ PRIVATE_KEY not found in .dev.vars!');
    console.log('Please enter your private key (or set it in .dev.vars as PRIVATE_KEY=0x...):');
    process.stdout.write('> ');
    privateKey = await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', (data) => {
        process.stdin.pause();
        resolve(data.toString().trim());
      });
    });
  }

  if (!privateKey) {
    throw new Error('Private key is required to send the transaction.');
  }

  // Setup Provider & Wallet for Base Sepolia
  const rpcUrl = process.env.ALCHEMY_API_KEY 
    ? `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : 'https://sepolia.base.org';
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey as string, provider);

  console.log(`\n[3] Connected to wallet: ${wallet.address}`);

  // Setup ERC20 Contract
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);

  console.log(`Fetching token details for ${tokenAddress}...`);
  const decimals = await tokenContract.decimals();
  const symbol = await tokenContract.symbol();
  
  // amount from API is typically whole units (e.g. 1)
  const amountToSend = ethers.parseUnits(amount.toString(), decimals);

  console.log(`\n[4] Sending ${amount} ${symbol} to ${recipient}...`);
  const tx = await tokenContract.transfer(recipient, amountToSend);
  
  console.log(`Tx Hash: ${tx.hash}`);
  console.log('Waiting for confirmation...');
  await tx.wait();
  console.log('✅ Transaction confirmed!');

  // Now make the actual request with the proof
  console.log(`\n[5] Retrying request with x-402-payment-proof: ${tx.hash}`);
  
  const finalRes = await fetch(targetUrl, {
    headers: {
      'x-402-payment-proof': tx.hash
    }
  });

  console.log(`\n[6] Final Response Status: ${finalRes.status}`);
  
  if (finalRes.ok) {
    const contentType = finalRes.headers.get('content-type');
    const contentLength = finalRes.headers.get('content-length') || 'unknown';
    console.log(`✅ Success! Received asset.`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Content-Length: ${contentLength} bytes`);
    
    // We can also save it if needed, or just say it works
    console.log(`Asset successfully unlocked and served!`);
  } else {
    console.error('❌ Failed to unlock asset!');
    const errorText = await finalRes.text();
    console.log('Response:', errorText);
  }
}

main().catch(console.error);
