import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

import {
  Adapter,
  AdapterResult,
  AdapterOptions,
  globPattern,
  ImageFormat,
  imageFormats,
} from '@imagejs/core';
import { Readable } from 'stream';

export const isENOENT = (error: unknown) => error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

export default class FSAdapter extends Adapter {
  override readonly supportsSave = true;
  override readonly supportsList = true;
  override readonly supportsDelete = true;
  override readonly supportsClean = true;
  override readonly supportsStream = true;

  constructor(path: string, options?: Partial<AdapterOptions>) {
    super(path, options);
  }

  override async has(id: string, prefixBase = true): Promise<boolean> {
    const fileTarget = path.join(process.cwd(), prefixBase ? path.join(this.basePath, id) : id);
    try {
      await fs.promises.access(fileTarget);
      return true;
    } catch (error) {
      return false;
    }
  }

  override async fetch(id: string, prefixBase = true): Promise<AdapterResult | undefined> {
    const fileTarget = path.join(process.cwd(), prefixBase ? path.join(this.basePath, id) : id);
    const fileExtension = path.extname(fileTarget).slice(1) as ImageFormat;
    if (!imageFormats.includes(fileExtension)) {
      return undefined;
    }

    if (!await this.has(id, prefixBase)) {
      return undefined;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(fileTarget);
    } catch (error) {
      if (isENOENT(error)) {
        return undefined;
      }
      throw new Error(`Could not read file at path "${fileTarget}": ${error}`);
    }
    
    return {
      format: fileExtension,
      data: buffer,
    };
  }

  override async stream(id: string, prefixBase = true): Promise<undefined | AdapterResult<Readable>> {
    const fileTarget = path.join(process.cwd(), prefixBase ? path.join(this.basePath, id) : id);
    const fileExtension = path.extname(fileTarget).slice(1) as ImageFormat;
    if (!imageFormats.includes(fileExtension)) {
      return undefined;
    }
    if (!await this.has(id, prefixBase)) {
      return undefined;
    }
    const stream = fs.createReadStream(fileTarget);
    stream.on('error', (error) => {
      if (isENOENT(error)) {
        return undefined;
      }
      throw new Error(`Could not read file at path "${fileTarget}": ${error}`);
    });
    return {
      data: stream,
      format: fileExtension,
    };
  }
  
  override async save(id: string, data: Buffer): Promise<void> {
    const dirTarget = path.join(process.cwd(), path.dirname(id));
    if (!fs.existsSync(dirTarget)) {
      await fs.promises.mkdir(dirTarget, { recursive: true });
    }
    const fileTarget = path.join(dirTarget, path.basename(id));
    await fs.promises.writeFile(fileTarget, data);
  }

  override async listImages(dir?: string): Promise<string[]> {
    const dirTarget = path.join(process.cwd(), dir ?? this.basePath);
    return glob(
      globPattern,
      {
        cwd: dirTarget,
        nodir: true,
        ignore: this.ignorePatterns,
      }
    );
  }

  override async delete(id: string): Promise<void> {
    const fileTarget = path.join(process.cwd(), path.join(this.basePath, id));
    try {
      await fs.promises.unlink(fileTarget);
    } catch (error) {
      throw new Error(`Could not delete file at path "${id}": ${error}`);
    }
  }

  override async clean(): Promise<void> {
    const dirTarget = path.join(process.cwd(), this.basePath);
    try {
      await fs.promises.rm(dirTarget, {
        recursive: true,
        force: true,
      });
    } catch (error) {
      throw new Error(`Could not clean directory at path "${this.basePath}": ${error}`);
    }  
  }
}