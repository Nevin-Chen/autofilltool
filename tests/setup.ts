/**
 * Vitest setup. jsdom 24 doesn't ship Blob.prototype.arrayBuffer or a
 * DataTransfer constructor, but the extension's production code (running in
 * real Chrome) relies on both. Polyfill them so unit tests can exercise the
 * file-input code paths without spinning up a browser.
 *
 * These polyfills are intentionally minimal — just enough for the assertions
 * in tests/unit/. Anything more elaborate belongs in a Playwright e2e test
 * against a real Chromium.
 */

// --- Blob.prototype.arrayBuffer -----------------------------------------
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('FileReader returned non-ArrayBuffer'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsArrayBuffer(this);
    });
  };
}

// --- HTMLInputElement.files setter (relax jsdom's webidl check) ---------
// jsdom rejects anything that isn't its own FileList class. Our fake
// DataTransfer returns a FileList-shaped object, so we replace the setter
// with one that just stashes the value. Behaviorally identical for tests.
{
  const proto = HTMLInputElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'files');
  if (original?.set) {
    Object.defineProperty(proto, 'files', {
      configurable: true,
      get(this: HTMLInputElement): FileList | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).__filesShim ?? (original.get ? original.get.call(this) : null);
      },
      set(this: HTMLInputElement, value: FileList | null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).__filesShim = value;
      },
    });
  }
}

// --- DataTransfer --------------------------------------------------------
// Minimal stand-in: just enough to support `dt.items.add(file)` followed by
// reading `dt.files`. Mirrors the slice of the spec the filler uses.
if (typeof (globalThis as { DataTransfer?: unknown }).DataTransfer === 'undefined') {
  class FakeFileList extends Array<File> {
    item(index: number): File | null {
      return this[index] ?? null;
    }
  }

  class FakeDataTransferItemList {
    private readonly _files: File[];
    constructor(files: File[]) {
      this._files = files;
    }
    add(data: File | string, _kind?: string): void {
      if (data instanceof File) this._files.push(data);
    }
    clear(): void {
      this._files.length = 0;
    }
    get length(): number {
      return this._files.length;
    }
  }

  class FakeDataTransfer {
    readonly items: FakeDataTransferItemList;
    private readonly _files: File[] = [];
    constructor() {
      this.items = new FakeDataTransferItemList(this._files);
    }
    get files(): FileList {
      // Cast to FileList — FakeFileList is structurally compatible for our uses.
      return new FakeFileList(...this._files) as unknown as FileList;
    }
  }
  (globalThis as unknown as { DataTransfer: typeof FakeDataTransfer }).DataTransfer =
    FakeDataTransfer;
}

// --- DOMMatrix -----------------------------------------------------------
// pdfjs-dist evaluates `const SCALE_MATRIX = new DOMMatrix()` at module load,
// but jsdom doesn't implement DOMMatrix, so importing pdfjs throws a
// ReferenceError before any test runs. Text extraction never rasterises, so a
// no-op stub is enough to let the module import; its geometry methods go unused.
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  class DOMMatrixStub {
    // Accept the optional init arg pdfjs passes in its (unused-here) render paths.
    constructor(_init?: string | number[]) {}
  }
  (globalThis as unknown as { DOMMatrix: typeof DOMMatrixStub }).DOMMatrix = DOMMatrixStub;
}
