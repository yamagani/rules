/** Vercel Functions (Node.js runtime) entry: the whole BFF as one function. */
import { handle } from '@hono/node-server/vercel';
import { createApp } from './app';

export default handle(createApp());
