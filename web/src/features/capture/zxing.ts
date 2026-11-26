// Lazy-loaded only when the native BarcodeDetector is missing (e.g. iOS Safari).
// The .wasm is bundled and served from our own origin (no third-party CDN).
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

export { readBarcodes };
