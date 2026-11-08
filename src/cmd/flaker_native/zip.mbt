///|
/// A file entry extracted from a ZIP archive.
pub struct ZipEntry {
  name : String
  data : Bytes
}

///|
/// Copy a range of bytes.
fn bytes_slice(b : Bytes, start : Int32, end : Int32) -> Bytes {
  let actual_end = if end > b.length() { b.length() } else { end }
  let len = actual_end - start
  if len <= 0 {
    return Bytes::new(0)
  }
  Bytes::makei(len, fn(i) { b[start + i] })
}

///|
/// Extract files from a ZIP archive.
///  Supports: stored + deflate, with data descriptor (bit 3).
pub fn unzip(zip_bytes : Bytes) -> Array[ZipEntry] {
  let entries : Array[ZipEntry] = []
  let len = zip_bytes.length()
  let mut offset = 0
  while offset + 30 <= len {
    if zip_bytes[offset] != b'\x50' ||
      zip_bytes[offset + 1] != b'\x4b' ||
      zip_bytes[offset + 2] != b'\x03' ||
      zip_bytes[offset + 3] != b'\x04' {
      break
    }
    let gp_flags = read_u16(zip_bytes, offset + 6)
    let compression = read_u16(zip_bytes, offset + 8)
    let mut compressed_size = read_u32(zip_bytes, offset + 18)
    let name_len = read_u16(zip_bytes, offset + 26)
    let extra_len = read_u16(zip_bytes, offset + 28)
    let data_start = offset + 30 + name_len + extra_len

    let name = bytes_to_string(
      bytes_slice(zip_bytes, offset + 30, offset + 30 + name_len),
    )

    // Bit 3: data descriptor follows the compressed data
    // In this case, compressed_size in local header is 0
    let has_data_descriptor = (gp_flags & 0x08) != 0
    if has_data_descriptor && compressed_size == 0 {
      // Scan for data descriptor: PK\x07\x08 or just the crc32+sizes
      // Central directory has the correct sizes, but we can search for next local header
      compressed_size = find_compressed_size(zip_bytes, data_start, len)
    }

    if data_start + compressed_size <= len && compressed_size > 0 {
      let raw = bytes_slice(zip_bytes, data_start, data_start + compressed_size)
      let data = if compression == 0 {
        raw
      } else if compression == 8 {
        @zlib.deflate_decompress(raw) catch {
          _ => raw
        }
      } else {
        raw
      }
      if !name.has_suffix("/") {
        entries.push({ name, data, })
      }
    }

    // Advance past data + optional data descriptor
    let mut next = data_start + compressed_size
    if has_data_descriptor {
      // Data descriptor: optional signature (4) + crc32 (4) + compressed_size (4) + uncompressed_size (4)
      if next + 4 <= len &&
        zip_bytes[next] == b'\x50' &&
        zip_bytes[next + 1] == b'\x4b' &&
        zip_bytes[next + 2] == b'\x07' &&
        zip_bytes[next + 3] == b'\x08' {
        next = next + 16 // signature + crc32 + sizes
      } else {
        next = next + 12 // no signature, just crc32 + sizes
      }
    }
    offset = next
  }
  entries
}

///|
/// Find compressed data size by scanning for next local header or central directory.
fn find_compressed_size(
  zip_bytes : Bytes,
  data_start : Int32,
  len : Int32,
) -> Int32 {
  let mut pos = data_start
  while pos + 4 <= len {
    if zip_bytes[pos] == b'\x50' && zip_bytes[pos + 1] == b'\x4b' {
      let sig = zip_bytes[pos + 2]
      let sig2 = zip_bytes[pos + 3]
      // Next local header (03 04) or central dir (01 02) or data descriptor (07 08)
      if (sig == b'\x03' && sig2 == b'\x04') ||
        (sig == b'\x01' && sig2 == b'\x02') ||
        (sig == b'\x07' && sig2 == b'\x08') {
        return pos - data_start
      }
    }
    pos = pos + 1
  }
  len - data_start
}

///|
fn read_u16(b : Bytes, offset : Int32) -> Int32 {
  b[offset].to_int() | (b[offset + 1].to_int() << 8)
}

///|
fn read_u32(b : Bytes, offset : Int32) -> Int32 {
  b[offset].to_int() |
  (b[offset + 1].to_int() << 8) |
  (b[offset + 2].to_int() << 16) |
  (b[offset + 3].to_int() << 24)
}
