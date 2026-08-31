import 'dotenv/config';

async function testOpensea(chain) {
  const res = await fetch(`https://api.opensea.io/api/v2/chain/${chain}/contract/0x0000000000000000000000000000000000000000`, {
    headers: { 'x-api-key': process.env.OPENSEA_API_KEY || '' }
  });
  console.log(`${chain}: ${res.status}`);
}

async function main() {
  await testOpensea('polygon');
  await testOpensea('matic');
}

main().catch(console.error);
