import { Redis } from '@upstash/redis';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface OAuthBrokerRawStore {
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | undefined>;
  take(key: string): Promise<string | undefined>;
  remove(key: string): Promise<void>;
}

type MemoryEntry = {
  expiresAt: number;
  value: string;
};

export class MemoryOAuthBrokerRawStore implements OAuthBrokerRawStore {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.#entries.set(key, {
      expiresAt: this.#now() + ttlSeconds * 1_000,
      value,
    });
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async take(key: string): Promise<string | undefined> {
    const value = await this.get(key);
    this.#entries.delete(key);
    return value;
  }

  async remove(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  snapshot(): ReadonlyMap<string, MemoryEntry> {
    return new Map(this.#entries);
  }
}

export class UpstashOAuthBrokerRawStore implements OAuthBrokerRawStore {
  readonly #redis: Redis;

  constructor(url: string, token: string) {
    if (!url || !token) {
      throw new Error('OAuth broker Redis configuration is incomplete');
    }
    this.#redis = new Redis({ url, token });
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.#redis.set(key, value, { ex: ttlSeconds });
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.#redis.get<string>(key);
    return typeof value === 'string' ? value : undefined;
  }

  async take(key: string): Promise<string | undefined> {
    const value = await this.#redis.getdel<string>(key);
    return typeof value === 'string' ? value : undefined;
  }

  async remove(key: string): Promise<void> {
    await this.#redis.del(key);
  }
}

function decodeEncryptionKey(encoded: string): Buffer {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error('OAuth broker encryption key is missing');
  }

  const candidates = [
    Buffer.from(trimmed, 'base64url'),
    Buffer.from(trimmed, 'base64'),
    /^[a-f0-9]{64}$/iu.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.alloc(0),
  ];
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) {
    throw new Error('OAuth broker encryption key must decode to exactly 32 bytes');
  }
  return key;
}

function recordKey(kind: string, handle: string): string {
  const digest = createHash('sha256').update(handle, 'utf8').digest('base64url');
  return `auth:mcp-oauth:v1:${kind}:${digest}`;
}

function seal(key: Buffer, aad: string, value: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    nonce.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function open<T>(key: Buffer, aad: string, envelope: string): T | undefined {
  const [version, nonceText, tagText, ciphertextText, ...extra] = envelope.split('.');
  if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra.length > 0) {
    return undefined;
  }

  try {
    const nonce = Buffer.from(nonceText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const ciphertext = Buffer.from(ciphertextText, 'base64url');
    if (nonce.length !== 12 || tag.length !== 16) {
      return undefined;
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    return JSON.parse(plaintext) as T;
  } catch {
    return undefined;
  }
}

export class EncryptedOAuthBrokerStore {
  readonly #raw: OAuthBrokerRawStore;
  readonly #key: Buffer;

  constructor(raw: OAuthBrokerRawStore, encryptionKey: string) {
    this.#raw = raw;
    this.#key = decodeEncryptionKey(encryptionKey);
  }

  async put(kind: string, handle: string, value: unknown, ttlSeconds: number): Promise<void> {
    const key = recordKey(kind, handle);
    await this.#raw.put(key, seal(this.#key, key, value), ttlSeconds);
  }

  async get<T>(kind: string, handle: string): Promise<T | undefined> {
    const key = recordKey(kind, handle);
    const envelope = await this.#raw.get(key);
    return envelope ? open<T>(this.#key, key, envelope) : undefined;
  }

  async take<T>(kind: string, handle: string): Promise<T | undefined> {
    const key = recordKey(kind, handle);
    const envelope = await this.#raw.take(key);
    return envelope ? open<T>(this.#key, key, envelope) : undefined;
  }

  async remove(kind: string, handle: string): Promise<void> {
    await this.#raw.remove(recordKey(kind, handle));
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createPkcePair(): { challenge: string; verifier: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { challenge, verifier };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
