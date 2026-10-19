import { createApp } from './app.js';
import {trace} from '@vcp/domain/logging';
async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(Number(process.env["PORT"] ?? 3001), process.env['API_HOST'] ?? '127.0.0.1');
}
void trace('api.startup',bootstrap).catch(()=>{process.exitCode=1});
