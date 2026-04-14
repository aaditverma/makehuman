/**
 * bindingMapCodec.ts — Binding Map Serialization / Deserialization
 *
 * Binary format for efficient storage and loading of garment-to-SMPL
 * barycentric binding maps.
 *
 * Layout:
 *   Header (10 bytes):
 *     magic:        uint32  (4 bytes) — 0x424D4150 "BMAP"
 *     version:      uint16  (2 bytes)
 *     vertexCount:  uint32  (4 bytes)
 *   Per-vertex records (20 bytes each):
 *     faceIndex:    uint32  (4 bytes)
 *     baryU:        float32 (4 bytes)
 *     baryV:        float32 (4 bytes)
 *     baryW:        float32 (4 bytes)
 *     normalOffset: float32 (4 bytes)
 *   Total size: 10 + vertexCount × 20 bytes
 */

/** Magic number: "BMAP" in ASCII = 0x424D4150 */
export const BINDING_MAP_MAGIC = 0x424d4150;
export const BINDING_MAP_VERSION = 1;

/** Header size in bytes */
export const BINDING_MAP_HEADER_BYTES = 10;

/** Per-vertex record size in bytes */
export const BINDING_MAP_ENTRY_BYTES = 20;

/** A single garment vertex → SMPL triangle binding */
export interface BindingEntry {
  faceIndex: number;
  baryU: number;
  baryV: number;
  baryW: number;
  normalOffset: number;
}

/** Complete binding map for a garment */
export interface BindingMap {
  version: number;
  vertexCount: number;
  entries: BindingEntry[];
}

/**
 * Serialize a BindingMap to a compact binary ArrayBuffer.
 */
export function serializeBindingMap(map: BindingMap): ArrayBuffer {
  const totalBytes =
    BINDING_MAP_HEADER_BYTES + map.vertexCount * BINDING_MAP_ENTRY_BYTES;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, BINDING_MAP_MAGIC, true);
  offset += 4;
  view.setUint16(offset, map.version, true);
  offset += 2;
  view.setUint32(offset, map.vertexCount, true);
  offset += 4;

  // Per-vertex records
  for (let i = 0; i < map.vertexCount; i++) {
    const e = map.entries[i];
    view.setUint32(offset, e.faceIndex, true);
    offset += 4;
    view.setFloat32(offset, e.baryU, true);
    offset += 4;
    view.setFloat32(offset, e.baryV, true);
    offset += 4;
    view.setFloat32(offset, e.baryW, true);
    offset += 4;
    view.setFloat32(offset, e.normalOffset, true);
    offset += 4;
  }

  return buffer;
}

/**
 * Deserialize a BindingMap from a binary ArrayBuffer.
 * Rejects files with wrong magic number or unrecognized version.
 */
export function deserializeBindingMap(buffer: ArrayBuffer): BindingMap {
  if (buffer.byteLength < BINDING_MAP_HEADER_BYTES) {
    throw new Error(
      `Binding map buffer too small for header: expected at least ${BINDING_MAP_HEADER_BYTES} bytes, got ${buffer.byteLength}`,
    );
  }

  const view = new DataView(buffer);
  let offset = 0;

  // Magic
  const magic = view.getUint32(offset, true);
  offset += 4;
  if (magic !== BINDING_MAP_MAGIC) {
    throw new Error(
      `Invalid binding map magic number: expected 0x${BINDING_MAP_MAGIC.toString(16).toUpperCase()} ("BMAP"), got 0x${magic.toString(16).toUpperCase()}`,
    );
  }

  // Version
  const version = view.getUint16(offset, true);
  offset += 2;
  if (version !== BINDING_MAP_VERSION) {
    throw new Error(
      `Unrecognized binding map version: expected ${BINDING_MAP_VERSION}, got ${version}`,
    );
  }

  // Vertex count
  const vertexCount = view.getUint32(offset, true);
  offset += 4;

  // Validate buffer size
  const expectedBytes =
    BINDING_MAP_HEADER_BYTES + vertexCount * BINDING_MAP_ENTRY_BYTES;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `Binding map buffer truncated: expected ${expectedBytes} bytes for ${vertexCount} vertices, got ${buffer.byteLength}`,
    );
  }

  // Read per-vertex records
  const entries: BindingEntry[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    entries[i] = {
      faceIndex: view.getUint32(offset, true),
      baryU: view.getFloat32(offset + 4, true),
      baryV: view.getFloat32(offset + 8, true),
      baryW: view.getFloat32(offset + 12, true),
      normalOffset: view.getFloat32(offset + 16, true),
    };
    offset += BINDING_MAP_ENTRY_BYTES;
  }

  return { version, vertexCount, entries };
}
