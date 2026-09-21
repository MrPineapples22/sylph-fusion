import fs from 'node:fs';
import { sanitizeRpcUrl } from '../dist/rpc.js';

if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf8');
  const lines = content.split('\n');
  const rpcLine = lines.find(l => l.startsWith('RPC_URLS='));
  const wsLine = lines.find(l => l.startsWith('WS_URLS='));
  const modeLine = lines.find(l => l.startsWith('MODE='));

  console.log('Mode:', modeLine?.trim());
  if (rpcLine) {
    const rawUrls = rpcLine.replace('RPC_URLS=', '').trim().split(',').map(s => s.trim());
    console.log('RPC Count:', rawUrls.length);
    const sanitized = rawUrls.map(u => sanitizeRpcUrl(u));
    console.log('RPC Labels (Sanitized):', sanitized);
    const isPublic = rawUrls.some(u => u.includes('api.mainnet-beta.solana.com') || u.includes('publicnode.com'));
    console.log('Contains Public Endpoints:', isPublic);
  }
} else {
  console.log('.env not found');
}
