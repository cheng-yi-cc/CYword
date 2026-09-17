import fs from 'node:fs';
import http from 'node:http';
const file = new URL('../../authoring/cet4/review/index.html', import.meta.url);
if (!fs.existsSync(file)) throw Error('先运行 npm run cet4:review:build');
const port = 5188;
const server = http.createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/index.html'].includes(request.url)) {
    response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});response.end('Not found');return;
  }
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
  fs.createReadStream(file).pipe(response);
});
server.on('error', error => {console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`四级审稿预览 http://127.0.0.1:${port}/ （Ctrl+C 结束）`));
