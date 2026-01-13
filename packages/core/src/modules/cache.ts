import debug from 'debug';
import { Hash, createHash } from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';

export type Algorithm = typeof createHash['arguments'][0];
export type Encoding = typeof Hash['arguments'][0];

export type HashOptions = {
  algorithm: Algorithm;
  encoding: Encoding;
  length: number;
  ttl: number | null;
  maxEntries: number | null;
}

export class HashCache<K = string, V = string> implements HashOptions, Map<K, V>{
  public algorithm: Algorithm;
  public encoding: Encoding;
  public length: number;
  public ttl: number | null;
  public maxEntries: number | null;
  static readonly defaults: HashOptions = {
    algorithm: 'sha256',
    encoding: 'hex',
    length: 14,
    ttl: 1000 * 60 * 60, // 1 hour
    maxEntries: null,
  };
  readonly log = debug('imagejs:cache');
  protected _cache: Map<K, V> = new Map<K, V>();

  constructor(options: Partial<HashOptions> = {}) {
    this.algorithm = options.algorithm ?? HashCache.defaults.algorithm;
    this.encoding = options.encoding ?? HashCache.defaults.encoding;
    this.length = options.length ?? HashCache.defaults.length;
    this.ttl = options.ttl ?? HashCache.defaults.ttl;
    this.maxEntries = options.maxEntries ?? HashCache.defaults.maxEntries;

    if (this.length <= 0) {
      throw new Error('The hash length must be greater than 0');
    }
  }

  computeBufferHash(
    buffer: Buffer,
    options: Partial<HashOptions> = {}
  ): string {
    this.log(`Computing hash for buffer of length ${buffer.length}`);
    return createHash(options.algorithm ?? this.algorithm)
      .update(buffer)
      .digest(options.encoding ?? this.encoding)
      .slice(0, options.length ?? this.length);
  }

  async computeStreamHash(
    stream: Readable,
    options: Partial<HashOptions> = {}
  ): Promise<string> {
    this.log(`Computing hash for stream`);
    return new Promise((resolve, reject) => {
      const hash = createHash(options.algorithm ?? this.algorithm);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        resolve(hash.digest(options.encoding ?? this.encoding).slice(0, options.length ?? this.length));
      });
      stream.on('error', (err) => reject(err));
    });
  }

  computeAnyHash(
    value: unknown,
    options: Partial<HashOptions> = {}
  ): string {
    this.log(`Computing hash for value of type ${typeof value}`);
    return this.computeBufferHash(
      Buffer.from(JSON.stringify(value)),
      options
    );
  }

  /**
   * Get the value for an identifier from the cache.
   * @param id - The identifier to get the value for.
   * @returns The value for the identifier.
   */
  get(id: K) {
    this.log(`Getting value for identifier "${id}"`);
    return this._cache.get(id);
  }

  /**
   * Set the value for an identifier.
   * @param id - The identifier to set the value for.
   * @param value - The value to associate with the identifier.
   * @param ttl - The time-to-live for the value.
   */
  set(id: K, value: V, ttl: number | null = this.ttl) {
    this.log(`Setting value for identifier "${id}"`);
    this._cache.set(id, value);
    this.handleConstraints(id, ttl);
    return this;
  }

  /**
   * Delete the value for an identifier.
   * @param id - The identifier to delete the value for.
   */
  delete(id: K) {
    this.log(`Deleting value for identifier "${id}"`);
    const deleted = this._cache.delete(id);
    this.expiryMap.delete(id);
    return deleted;
  }

  /**
   * Clear the cache.
   */
  clear() {
    this.log(`Clearing cache`);
    this._cache.clear();
    this.expiryMap.forEach(({ timeout }) => clearTimeout(timeout));
    this.expiryMap.clear();
  }

  /**
   * Check if the cache contains a value for an identifier.
   * @param id - The identifier to check for.
   * @returns Whether the cache contains a value for the identifier.
   */
  has(id: K) {
    this.log(`Checking if cache contains value for identifier "${id}"`);
    return this._cache.has(id);
  }

  /**
   * Get the number of entries in the cache.
   * @returns The number of entries in the cache.
   */
  get size() {
    return this._cache.size;
  }

  /**
   * Iterate over the entries in the cache.
   * @param callback - The callback to invoke for each entry.
   */
  forEach(callback: (_value: V, _key: K, _map: Map<K, V>) => void) {
    this._cache.forEach(callback);
  }

  /**
   * Get the keys in the cache.
   * @returns The keys in the cache.
   */
  keys() {
    return this._cache.keys();
  }

  /**
   * Get the entries in the cache.
   * @returns The entries in the cache.
   */
  entries() {
    return this._cache.entries();
  }

  /**
   * Get the values in the cache.
   * @returns The values in the cache.
   */
  values() {
    return this._cache.values();
  }


  /**
   * Iterate over the entries in the cache.
   * @returns An iterator for the entries in the cache.
   */
  [Symbol.iterator]() {
    return this._cache[Symbol.iterator]();
  }

  /**
   * Get the string tag for the cache.
   */
  [Symbol.toStringTag]: 'CacheMap' = 'CacheMap';

  // Handle TTL and max entries (Cache constraints)
  protected expiryMap: Map<K, {
    ts: number;
    timeout: NodeJS.Timeout;
  }> = new Map<K, {
    ts: number;
    timeout: NodeJS.Timeout;
  }>();
  private hasTTL(): this is HashCache & {
    ttl: number;
  } {
    return this.ttl !== null;
  }
  private hasMaxEntries(offset: number = 0) {
    return this.maxEntries !== null && this._cache.size + offset >= this.maxEntries;
  }
  protected handleConstraints(id: K, ttl: number | null = this.ttl) {
    if (typeof ttl === 'number' || this.hasTTL()) {
      const current = this.expiryMap.get(id);
      if (current) clearTimeout(current.timeout);
      this.expiryMap.set(id, {
        ts: Date.now(),
        timeout: setTimeout(() => {
          this.delete(id);
        }, typeof ttl === 'number' ? ttl : this.ttl as number).unref(),
      });
    }
    if (this.hasMaxEntries(-1)) {
      const first = this._cache.keys().next().value;
      if (typeof first === 'undefined') {
        return;
      }
      this.delete(first);
    }
  }
}

export class PersistentHashCache extends HashCache {
  private _cachePath: string = '.cache';
  private _cacheSaveEvery: number = 5000;
  private _cacheHash: string | null = null;

  constructor(options: Partial<HashOptions> = {}) {
    super(options);
    this.loadCache(this._cachePath).then(() => {
      this.throttleSaveCache(this._cachePath);
    });
  }

  override set(id: string, value: string, ttl: number | null = this.ttl) {
    super.set(id, value, ttl);
    this.throttleSaveCache();
    return this;
  }

  override delete(id: string) {
    const deleted = super.delete(id);
    this.throttleSaveCache();
    return deleted;
  }

  override clear() {
    super.clear();
    this.throttleSaveCache();
  }

  override handleConstraints(id: string, ttl: number | null = this.ttl) {
    super.handleConstraints(id, ttl);
    this.throttleSaveCache();
  }

  /**
   * Load the cache into memory from a file.
   * @param from - The path to the cache file.
   * @returns A promise that resolves when the cache has been loaded.
   */
  private loadCache = async (from: string = this._cachePath) => {
    this.log(`Loading cache from file at path "${from}"`);
    await this.ensureCacheFileExists();
    const data = await fs.promises.readFile(from);
    let cache;
    try {
      cache = JSON.parse(data.toString());
    } catch (err) {
      this.log(`Failed to parse cache file at path "${from}"`);
      cache = {};
    }
    this._cacheHash = this.computeAnyHash(cache);
    for (const [key, value] of Object.entries(cache)) {
      if (typeof value !== 'string') {
        this.log(`Skipping cache entry for key "${key}" with invalid value`);
        continue;
      }
      this.log(`Loaded cache entry for key "${key}"`);
      this._cache.set(key, value);
    }
    this.log(`Loaded cache from file at path "${from}"`);
  };

  private saveCache = async (to: string = this._cachePath) => {
    this.log(`Saving cache to file at path "${to}"`);
    await this.ensureCacheFileExists();
    return fs.promises.writeFile(to, JSON.stringify(Object.fromEntries(this._cache.entries())));
  };

  private _cacheFileExists = false;
  private ensureCacheFileExists = async () => {
    if (this._cacheFileExists) {
      return;
    }
    if (!fs.existsSync(this._cachePath)) {
      await fs.promises.writeFile(this._cachePath, JSON.stringify({}));
    }
    this._cacheFileExists = true;
  };

  private _throttleSaveCacheTimeout: NodeJS.Timeout | null = null;
  private throttleSaveCache = (to: string = this._cachePath) => {
    if (this._throttleSaveCacheTimeout) {
      this.log(`++ Cache save already scheduled, returning`);
      return;
    }
    this.log(`++ Saving cache in ${this._cacheSaveEvery}ms`);
    this._throttleSaveCacheTimeout = setTimeout(() => {
      this.throttleSaveRun(to);
    }, this._cacheSaveEvery).unref();
  };
  private throttleSaveRun = (to: string = this._cachePath) => {
    const currCacheHash = this.computeAnyHash(Object.fromEntries(this._cache.entries()));
    if (currCacheHash === this._cacheHash) {
      this.log(`=== Cache has not changed, skipping save`);
      this._throttleSaveCacheTimeout = null;
      return;
    }
    this._cacheHash = currCacheHash;
    this.log(`=!= Cache has changed, saving`);
    this.saveCache(to);
    this._throttleSaveCacheTimeout = null;
  };
}