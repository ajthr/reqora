import { createReqoraServer } from './index.ts';

const port = Number(process.env.PORT || 3001);
const server = createReqoraServer();
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Reqora API listening on port ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
