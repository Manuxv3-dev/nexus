import Redis from 'ioredis';

export async function isRedisAvailable(url: string): Promise<boolean> {
  try {
    const probe = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    return false;
  }
}
