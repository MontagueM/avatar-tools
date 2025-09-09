import { loadImage, Image as NapiImage } from "@napi-rs/canvas";
import { PolyfillBlobClass } from "./PolyfillBlobClass";

/**
 * Minimal Image polyfill for Node that supports:
 * - assigning data: URLs to `src` (used by GLTFLoader WebP/AVIF detection)
 * - assigning blob:// URLs to `src` (compat with URL.createObjectURL)
 * - onload/onerror events
 * - width/height properties populated after load
 */
export class PolyfillImageClass {
  onload: (() => void) | null = null;
  onerror: ((err?: unknown) => void) | null = null;
  width = 0;
  height = 0;

  // Keep a reference for compatibility if someone checks instanceof
  static [Symbol.hasInstance](instance: unknown) {
    return (
      typeof instance === "object" &&
      instance !== null &&
      "onload" in (instance as any) &&
      "onerror" in (instance as any)
    );
  }

  private _src: string | null = null;
  get src(): string | null {
    return this._src;
  }
  set src(value: string | null) {
    if (!value) {
      this._src = value;
      return;
    }
    this._src = value;

    // data URL handler (e.g., used in GLTFLoader detectSupport)
    if (value.startsWith("data:")) {
      try {
        const commaIndex = value.indexOf(",");
        const meta = value.slice(5, commaIndex); // after 'data:'
        const mime = meta.split(";")[0];

        // Avoid attempting to decode WebP/AVIF in Node; report unsupported by resolving height != 1
        if (mime === "image/webp" || mime === "image/avif") {
          this.width = 0;
          this.height = 0;
          if (typeof this.onload === "function") {
            this.onload();
          } else if (typeof this.onerror === "function") {
            this.onerror(new Error("Unsupported data URL format in Node"));
          }
          return;
        }
        const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
        const dataPart = value.slice(commaIndex + 1);
        const buffer = isBase64
          ? Buffer.from(dataPart, "base64")
          : Buffer.from(decodeURIComponent(dataPart), "utf8");
        this.#loadFromBuffer(buffer);
      } catch (err) {
        this.#emitError(err);
      }
      return;
    }

    // blob:// handler (produced by URL.createObjectURL in our polyfill)
    if (value.startsWith("blob://")) {
      const blobId = value.slice("blob://".length);
      const blob = PolyfillBlobClass.blobByBlobId.get(blobId);
      if (!blob) {
        this.#emitError(new Error("Blob not found"));
        return;
      }
      const buffer = Buffer.from(blob.buffer);
      this.#loadFromBuffer(buffer);
      return;
    }

    // Fallback: try passing through to @napi-rs/canvas NapiImage for file paths/URLs
    // Note: loadImage handles file paths and buffers; for remote URLs, users should prefetch.
    loadImage(value)
      .then((img) => this.#assignLoaded(img))
      .catch((err) => this.#emitError(err));
  }

  #loadFromBuffer(buffer: Buffer) {
    loadImage(buffer)
      .then((img) => this.#assignLoaded(img))
      .catch((err) => this.#emitError(err));
  }

  #assignLoaded(img: NapiImage) {
    // Populate dimensions for detectSupport checks
    this.width = (img as any).width ?? 0;
    this.height = (img as any).height ?? 0;
    if (typeof this.onload === "function") {
      try {
        this.onload();
      } catch {
        // ignore
      }
    }
  }

  #emitError(err?: unknown) {
    if (typeof this.onerror === "function") {
      try {
        this.onerror(err);
      } catch {
        // ignore
      }
    }
  }
}


