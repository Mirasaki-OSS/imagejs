import { ImageFormat, SizeByDimensions, SizeKey, SizeOptions } from './options';

export type Query = {
  [key: string]: undefined | string | Query | (string | Query)[];
}

export enum QueryParam {
  format = 'format', // Default: webp if supported, otherwise original
  size = 'size', // Default: original
  width = 'width', // Default: null
  height = 'height', // Default: null
  quality = 'quality', // Default: null for size queries, 80 for width/height queries
}

export enum TransformQueryParam {
  aspect_ratio = 'aspect_ratio', // Default: 'auto'
  sharpen = 'sharpen', // Default: false
  blur = 'blur', // Default: 0 (0 to 100)
  crop = 'crop', // Default: null ([width,height] OR [width,height,x,y])
  crop_gravity = 'crop_gravity', // Default: 'center'
  flip = 'flip', // Default: false
  flop = 'flop', // Default: false
  brightness = 'brightness', // Default: 0 (-100 to 100)
  saturation = 'saturation', // Default: 0 (-100 to 100)
  hue = 'hue', // Default: 0 (-100 to 100)
  contrast = 'contrast', // Default: 0 (-100 to 100)
  sepia = 'sepia', // Default: 0 (0 to 100)
  grayscale = 'grayscale', // Default: false
  trim = 'trim', // Default: false
}

export type QueryParams = {
  format: ImageFormat; // f
  // size: ImageSize; // s | w, h, q
  size: SizeKey | (SizeByDimensions & SizeOptions); // s | w, h, q
}

export type TransformQueryParams = {
  aspect_ratio: string;
  sharpen: boolean;
  blur: number;
  crop: null | [number, number] | [number, number, number, number];
  crop_gravity: Gravity;
  flip: boolean;
  flop: boolean;
  brightness: number;
  saturation: number;
  hue: number;
  contrast: number;
  sepia: number;
  grayscale: boolean;
  trim: boolean;
}

export type Gravity = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest' | 'center' | 'entropy' | 'attention';
