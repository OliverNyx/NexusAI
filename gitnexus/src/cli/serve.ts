import { createServer } from '../server/api.js';

export const serveCommand = async (options?: { port?: string }) => {
  const port = Number(options?.port ?? 4747);
  await createServer(port);
};

