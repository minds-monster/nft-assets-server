const { ethers } = require('ethers');

async function test() {
  const provider = new ethers.JsonRpcProvider('https://base-sepolia.g.alchemy.com/v2/alch_VVmI4RBT3r2VfeFCcei6C');
  const wallet = new ethers.Wallet('c88d1fb1049724a11f8b5c82eb7104eed2ff3a5c77483d756c51d71a072c36a9', provider);
  const manager = new ethers.NonceManager(wallet);
  
  // Create a contract instance with the NonceManager
  const tokenContract = new ethers.Contract(
    '0x8D916a6AeD915Bea3F2a7BBBA9B527A4b4a32cD6',
    ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"],
    manager
  );

  console.log("starting concurrent sends...");
  const p1 = tokenContract.transfer('0x59325733eb952a92e069c87f0a6168b29e80627f', 1n).catch(e => console.log('p1 err', e.message));
  const p2 = tokenContract.transfer('0x59325733eb952a92e069c87f0a6168b29e80627f', 1n).catch(e => console.log('p2 err', e.message));
  
  const [tx1, tx2] = await Promise.all([p1, p2]);
  if (tx1) console.log("tx1 nonce:", tx1.nonce);
  if (tx2) console.log("tx2 nonce:", tx2.nonce);
}

test();
