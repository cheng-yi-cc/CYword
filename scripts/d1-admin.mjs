import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);

// Administrative REST adapter; credentials stay in memory and are never logged.
// https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
export function remoteDatabase(accountId, databaseId) {
  if (!/^[a-f0-9]{32}$/.test(accountId) || !/^[a-f0-9-]{36}$/.test(databaseId)) throw Error('Invalid Cloudflare account/database ID');
  const credentials = process.env.CLOUDFLARE_API_TOKEN
    ? { token: process.env.CLOUDFLARE_API_TOKEN }
    : JSON.parse(execFileSync(process.execPath, [path.resolve(path.dirname(require.resolve('wrangler')), '../bin/wrangler.js'), 'auth', 'token', '--json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:30000 }));
  if (!credentials.token) throw Error('A scoped Cloudflare API token or Wrangler OAuth login is required');
  async function query(statements) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method:'POST', headers:{Authorization:`Bearer ${credentials.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({batch:statements}), signal:AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.result.some(r=>!r.success)) throw Error(`D1 administrative request failed (${response.status}; ${data.errors?.map(e=>e.code).join(',') || 'query error'})`);
    return data.result;
  }
  return {
    prepare(sql) {
      const statement = {sql, params:[]};
      return {
        bind(...values) {
          let index=0;
          // The adapter only executes repository-owned SQL. Binary parameters
          // become hex literals because the REST schema has no BLOB bind type.
          statement.sql=sql.replace(/\?(\d+)?/g,(_match,number)=>{
            const position=number?Number(number)-1:index;
            index=Math.max(index,position+1);
            const value=values[position];
            if(value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `X'${Buffer.from(value instanceof ArrayBuffer?value:new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).toString('hex')}'`;
            if(value !== null && !['string','number'].includes(typeof value)) throw Error('Unsupported D1 parameter');
            statement.params.push(value);return '?';
          });
          if(index!==values.length)throw Error('D1 parameter count mismatch');
          return this;
        },
        async first(){return (await query([statement]))[0].results[0]??null;},
        async all(){return (await query([statement]))[0];},
        async run(){return (await query([statement]))[0];},
        statement,
      };
    },
    batch(statements){return query(statements.map(s=>s.statement));},
  };
}
