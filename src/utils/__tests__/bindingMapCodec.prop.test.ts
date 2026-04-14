/**
 * Property-based tests for bindingMapCodec.ts — Tasks 6.2, 6.3
 *
 * Property 4: Binding map serialization round-trip
 * Property 5: Invalid binding map format rejection
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  serializeBindingMap,
  deserializeBindingMap,
  BINDING_MAP_MAGIC,
  BINDING_MAP_VERSION,
  BINDING_MAP_HEADER_BYTES,
  type BindingMap,
  type BindingEntry,
} from '../bindingMapCodec';

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

/** Generate a valid BindingEntry with barycentric coords summing to ~1 */
const bindingEntryArb: fc.Arbitrary<BindingEntry> = fc
  .tuple(
    fc.nat(100000),  // faceIndex
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: -0.1, max: 0.1, noNaN: true, noDefaultInfinity: true }),
  )
  .map(([faceIndex, a, b, normalOffset]) => {
    // Generate valid barycentric coords that sum to 1
    const u = a * (1 - b);
    const v = b;
    const w = 1 - u - v;
    return { faceIndex, baryU: u, baryV: v, baryW: w, normalOffset };
  });

/** Generate a valid BindingMap with 1-500 vertices */
const bindingMapArb: fc.Arbitrary<BindingMap> = fc
  .array(bindingEntryArb, { minLength: 1, maxLength: 500 })
  .map((entries) => ({
    version: BINDING_MAP_VERSION,
    vertexCount: entries.length,
    entries,
  }));

/* ------------------------------------------------------------------ */
/*  Property 4: Binding map serialization round-trip                   */
/* ------------------------------------------------------------------ */

describe('Property 4: Binding map serialization round-trip', () => {
  /**
   * **Validates: Requirements 9.3, 9.1, 9.2, 9.4**
   *
   * For any valid BindingMap object, serializing to binary and then
   * deserializing SHALL produce a BindingMap with identical values.
   */
  it('round-trips random BindingMap objects', () => {
    fc.assert(
      fc.property(bindingMapArb, (original) => {
        const buffer = serializeBindingMap(original);
        const result = deserializeBindingMap(buffer);

        expect(result.version).toBe(original.version);
        expect(result.vertexCount).toBe(original.vertexCount);
        expect(result.entries.length).toBe(original.entries.length);

        for (let i = 0; i < original.vertexCount; i++) {
          const o = original.entries[i];
          const r = result.entries[i];
          expect(r.faceIndex).toBe(o.faceIndex);
          // Float32 precision: ~7 significant digits
          expect(r.baryU).toBeCloseTo(o.baryU, 5);
          expect(r.baryV).toBeCloseTo(o.baryV, 5);
          expect(r.baryW).toBeCloseTo(o.baryW, 5);
          expect(r.normalOffset).toBeCloseTo(o.normalOffset, 5);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 5: Invalid binding map format rejection                   */
/* ------------------------------------------------------------------ */

describe('Property 5: Invalid binding map format rejection', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * For any ArrayBuffer whose first 4 bytes do not match the BMAP magic
   * number or whose version field is not recognized, the deserializer
   * SHALL throw an error with a descriptive message.
   */
  it('rejects random ArrayBuffers with wrong magic number', () => {
    fc.assert(
      fc.property(
        fc.uint32Array({ minLength: 3, maxLength: 20 }).filter((arr) => {
          // Ensure the first uint32 is NOT the BMAP magic
          const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
          return view.getUint32(0, true) !== BINDING_MAP_MAGIC;
        }),
        (arr) => {
          const buffer = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
          // Must be at least header size to get past the size check
          if (buffer.byteLength >= BINDING_MAP_HEADER_BYTES) {
            expect(() => deserializeBindingMap(buffer)).toThrow(/magic/i);
          } else {
            expect(() => deserializeBindingMap(buffer)).toThrow();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects buffers with valid magic but invalid version', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 65535 }), // invalid version (only version 1 is valid)
        fc.nat(1000), // vertex count
        (version, vertexCount) => {
          const buffer = new ArrayBuffer(BINDING_MAP_HEADER_BYTES);
          const view = new DataView(buffer);
          view.setUint32(0, BINDING_MAP_MAGIC, true);
          view.setUint16(4, version, true);
          view.setUint32(6, vertexCount, true);

          expect(() => deserializeBindingMap(buffer)).toThrow(/version/i);
        },
      ),
      { numRuns: 100 },
    );
  });
});
