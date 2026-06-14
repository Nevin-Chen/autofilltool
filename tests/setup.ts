(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
      return new FakeFileList(...this._files) as unknown as FileList;
    }
  }
  (globalThis as unknown as { DataTransfer: typeof FakeDataTransfer }).DataTransfer =
    FakeDataTransfer;
}


if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  class DOMMatrixStub {
    constructor(_init?: string | number[]) {}
  }
  (globalThis as unknown as { DOMMatrix: typeof DOMMatrixStub }).DOMMatrix = DOMMatrixStub;
}
