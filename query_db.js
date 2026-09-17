import { createClient } from '@supabase/supabase-js';

import * as dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' }); // Also loads .env by default if we want, but .dev.vars has it
dotenv.config();

const url = process.env.DATABASE_URL;
const key = process.env.DATABASE_KEY;

const db = createClient(url, key);

async function main() {
  const { data, error } = await db.from('nft_assets')
    .select('*')
    .eq('chain', 'eth-mainnet')
    .eq('contract', '0x28472a58a490c5e09a238847f66a68a47cc76f0f')
    .eq('token_id', '0');
    
  console.log("Error:", error);
  console.log("Data:", JSON.stringify(data, null, 2));
}
main();
