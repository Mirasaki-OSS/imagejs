import debug from 'debug';
import { resolveSharpTransformer, resolveSize } from '../helpers';
import { ImageSize, QueryParams, TransformQueryParams } from '../types';
import { HashCache } from './cache';
import { Matrix3x3 } from 'sharp';

export type TransformImageInput = Omit<QueryParams & TransformQueryParams & {
  resourceId: string;
}, 'size'> & {
  size: ImageSize;
};

export type TransformImageInputWithBuffer = TransformImageInput & {
  image: Buffer;
}

export class ImageTransformer {
  hashCache: HashCache<string, Buffer>;
  
  constructor(cache: HashCache<string, Buffer>) {
    this.hashCache = cache;
  }

  protected readonly log = debug('imagejs:transformer');

  cacheKey(input: TransformImageInput) {
    const { format, size, aspect_ratio, sharpen, blur, crop, crop_gravity, flip, flop, brightness, saturation, hue, contrast, sepia, grayscale, trim } = input;
    return `transform:${input.resourceId}-${this.hashCache.computeAnyHash({ format, size, aspect_ratio, sharpen, blur, crop, crop_gravity, flip, flop, brightness, saturation, hue, contrast, sepia, grayscale, trim })}`;
  }

  /**
   * Resolves a -100 to 100 (user-input) scale to a
   * 0 to 2 scale for Sharp's transform function.
   * 
   * -100 becomes 0
   * 0 becomes 1
   * 100 becomes 2
   * @param value 
   */
  resolveUserInputScale = (value: number) => {
    return Math.min(Math.max(value / 100 + 1, 0), 2);
  };

  async transformImage(input: TransformImageInputWithBuffer) {
    this.log(`Transforming image to size ${JSON.stringify(input.size)} and format "${input.format}"`);

    const cacheKey = this.cacheKey(input);
    const cached = this.hashCache.get(cacheKey);
    if (cached) {
      this.log(`Found cached image for key "${cacheKey}"`);
      return cached;
    }

    const {
      image, format, size, sharpen, blur, crop, crop_gravity, flip, flop, brightness, saturation, hue, contrast, sepia, grayscale, trim,
    } = input;

    const resolvedSize = resolveSize(size);
    const transformer = resolveSharpTransformer(image, format)({
      quality: resolvedSize.quality,
    });

    transformer.rotate(); // Rotate based on EXIF Orientation tag

    // [DEV] Needs Aspect Ratio implementation
    if (crop) {
      this.log(`Cropping image to crop ${JSON.stringify(crop)} with gravity "${crop_gravity}"`);
      const [width, height, x, y] = crop;
      if (typeof x === 'number' && typeof y === 'number') {
        transformer.extract({
          left: x,
          top: y,
          width,
          height,
        });
      }
      else {
        transformer.resize(width, height, {
          fit: 'cover',
          position: crop_gravity,
        });
      }
    } else {
      this.log(`Resizing image to size (fit:inside) with width ${resolvedSize.width} and height ${resolvedSize.height}`);
      transformer.resize(resolvedSize.width, resolvedSize.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    if (flip) {
      transformer.flip();
    }

    if (flop) {
      transformer.flop();
    }
    
    const resolvedBrightness = this.resolveUserInputScale(brightness);
    const resolvedSaturation = this.resolveUserInputScale(saturation);
    const resolvedHue = this.resolveUserInputScale(hue);
    if (resolvedBrightness !== 0 || resolvedSaturation !== 0 || resolvedHue !== 0) {
      transformer.modulate({
        brightness: resolvedBrightness,
        saturation: resolvedSaturation,
        hue: resolvedHue,
      });
    }

    const resolvedContrast = this.resolveUserInputScale(contrast);
    if (resolvedContrast !== 0) {
      transformer.linear(1 + resolvedContrast / 100, 1 + resolvedContrast / 100);
    }

    const resolvedSepia = Math.min(Math.max(sepia, 0), 100);
    if (resolvedSepia !== 0) {
      const sepiaMatrix: Matrix3x3 = [
        [0.393 + 0.607 * (1 - resolvedSepia / 100), 0.769 - 0.769 * (1 - resolvedSepia / 100), 0.189 - 0.189 * (1 - resolvedSepia / 100)],
        [0.349 - 0.349 * (1 - resolvedSepia / 100), 0.686 + 0.314 * (1 - resolvedSepia / 100), 0.168 - 0.168 * (1 - resolvedSepia / 100)],
        [0.272 - 0.272 * (1 - resolvedSepia / 100), 0.534 - 0.534 * (1 - resolvedSepia / 100), 0.131 + 0.869 * (1 - resolvedSepia / 100)],
      ];
      transformer.recomb(sepiaMatrix);
    }

    if (grayscale) {
      transformer.grayscale();
    }

    if (trim) {
      transformer.trim();
    }

    if (sharpen) {
      transformer.sharpen();
    }

    const resolvedBlur = Math.min(Math.max(blur, 0), 100);
    if (resolvedBlur !== 0) {
      transformer.blur(resolvedBlur);
    }

    let buffer: Buffer;
    try {
      buffer = await transformer.toBuffer();
    } catch (error) {
      this.log(`Failed to transform image: ${error}`);
      // Return empty buffer on error to avoid crashing
      buffer = Buffer.alloc(0);
    }

    this.hashCache.set(cacheKey, buffer);
    return buffer;
  }
}