/**
 * Unit tests for bindingMapCodec.ts — Task 6.1
 *
 * Covers: round-trip serialization, wrong magic rejection, wrong version
 * rejection, truncated buffer rejection, empty binding map (0 vertices).
 */
import { describe, it, expect } from 'vitest';
import {
  serializeBindingMap,
  deserializeBindingMap,
  BINDING_MAP_MAGIC,
  BINDING_MAP_VERSION,
  BINDING_MAP_HEADER_BYTES,
  BINDING_MAP_ENTRY_BYTES,
  type BindingMap,
} from '../bindingMapCodec';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeEntry(i: number) {
  return {
    faceIndex: i * 10,
    baryU: 0.5,
    baryV: 0.3,
    baryW: 0.2,
    normalOffset: 0.005 * (i + 1),
  };
}

function makeMap(vertexCount: number): BindingMap {
  return {
    version: BINDING_MAP_VERSION,
    vertexCount,
    entries: Array.from({ length: vertexCount }, (_, i) => makeEntry(i)),
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('bindingMapCodec', () => {
  describe('round-trip serialization/deserialization', () => {
    it('round-trips a binding map with multiple vertices', () => {
      const original = makeMap(5);
      const buffer = serializeBindingMap(original);
      const result = deserializeBindingMap(buffer);

      expect(result.version).toBe(original.version);
      expect(result.vertexCount).toBe(original.vertexCount);
      expect(result.entries.length).toBe(original.entries.length);

      for (let i = 0; i < original.vertexCount; i++) {
        const o = original.entries[i];
        const r = result.entries[i];
        expect(r.faceIndex).toBe(o.faceIndex);
        expect(r.baryU).toBeCloseTo(o.baryU, 5);
        expect(r.baryV).toBeCloseTo(o.baryV, 5);
        expect(r.baryW).toBeCloseTo(o.baryW, 5);
        expect(r.normalOffset).toBeCloseTo(o.normalOffset, 5);
      }
    });

    it('produces correct buffer size', () => {
      const map = makeMap(100);
      const buffer = serializeBindingMap(map);
      expect(buffer.byteLength).toBe(
        BINDING_MAP_HEADER_BYTES + 100 * BINDING_MAP_ENTRY_BYTES,
      );
    });

    it('round-trips a single-vertex binding map', () => {
      const original: BindingMap = {
        version: BINDING_MAP_VERSION,
        vertexCount: 1,
        entries: [
          {
            faceIndex: 42,
            baryU: 0.333,
            baryV: 0.333,
            baryW: 0.334,
            normalOffset: -0.01,
          },
        ],
      };
      const result = deserializeBindingMap(serializeBindingMap(original));
      expect(result.entries[0].faceIndex).toBe(42);
      expect(result.entries[0].baryU).toBeCloseTo(0.333, 3);
      expect(result.entries[0].normalOffset).toBeCloseTo(-0.01, 3);
    });
  });

  describe('empty binding map (0 vertices)', () => {
    it('serializes and deserializes an empty binding map', () => {
      const original = makeMap(0);
      const buffer = serializeBindingMap(original);

      expect(buffer.byteLength).toBe(BINDING_MAP_HEADER_BYTES);

      const result = deserializeBindingMap(buffer);
      expect(result.version).toBe(BINDING_MAP_VERSION);
      expect(result.vertexCount).toBe(0);
      expect(result.entries).toEqual([]);
    });
  });

  describe('wrong magic number rejection', () => {
    it('rejects buffer with wrong magic number', () => {
      const buffer = serializeBindingMap(makeMap(3));
      const view = new DataView(buffer);
      view.setUint32(0, 0xdeadbeef, true); // overwrite magic

      expect(() => deserializeBindingMap(buffer)).toThrow(/magic/i);
    });

    it('includes expected and actual magic in error message', () => {
      const buffer = serializeBindingMap(makeMap(1));
      const view = new DataView(buffer);
      view.setUint32(0, 0x00000000, true);

      expect(() => deserializeBindingMap(buffer)).toThrow(/BMAP/);
    });
  });

  describe('wrong version rejection', () => {
    it('rejects buffer with unrecognized version', () => {
      const buffer = serializeBindingMap(makeMap(2));
      const view = new DataView(buffer);
      view.setUint16(4, 99, true); // overwrite version

      expect(() => deserializeBindingMap(buffer)).toThrow(/version/i);
    });

    it('includes expected and actual version in error message', () => {
      const buffer = serializeBindingMap(makeMap(1));
      const view = new DataView(buffer);
      view.setUint16(4, 255, true);

      expect(() => deserializeBindingMap(buffer)).toThrow(/255/);
    });
  });

  describe('truncated buffer rejection', () => {
    it('rejects buffer too small for header', () => {
      const buffer = new ArrayBuffer(6); // less than 10-byte header
      expect(() => deserializeBindingMap(buffer)).toThrow(/too small/i);
    });

    it('rejects buffer with valid header but truncated body', () => {
      // Build a valid header claiming 10 vertices, but only provide space for 2
      const buffer = new ArrayBuffer(
        BINDING_MAP_HEADER_BYTES + 2 * BINDING_MAP_ENTRY_BYTES,
      );
      const view = new DataView(buffer);
      view.setUint32(0, BINDING_MAP_MAGIC, true);
      view.setUint16(4, BINDING_MAP_VERSION, true);
      view.setUint32(6, 10, true); // claims 10 vertices

      expect(() => deserializeBindingMap(buffer)).toThrow(/truncated/i);
    });

    it('rejects zero-length buffer', () => {
      const buffer = new ArrayBuffer(0);
      expect(() => deserializeBindingMap(buffer)).toThrow(/too small/i);
    });
  });
});
