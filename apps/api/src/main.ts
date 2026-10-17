import { createApp } from './app.js';
async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(Number(process.env["PORT"] ?? 3001), process.env['API_HOST'] ?? '127.0.0.1');
}
void bootstrap();
