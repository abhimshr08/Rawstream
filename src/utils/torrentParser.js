// Client-Side Bencode Parser & SHA-1 infoHash Calculator

function decodeBencode(buffer) {
  let index = 0;

  function parse() {
    if (index >= buffer.length) {
      throw new Error('Unexpected end of file');
    }
    const char = String.fromCharCode(buffer[index]);

    // Integer: i<num>e
    if (char === 'i') {
      index++; // skip 'i'
      const start = index;
      while (index < buffer.length && buffer[index] !== 101) { // 101 is 'e'
        index++;
      }
      if (index >= buffer.length) {
        throw new Error('Unterminated integer');
      }
      const numStr = new TextDecoder().decode(buffer.subarray(start, index));
      index++; // skip 'e'
      return parseInt(numStr, 10);
    }

    // List: l<elements>e
    if (char === 'l') {
      index++; // skip 'l'
      const list = [];
      while (index < buffer.length && buffer[index] !== 101) {
        list.push(parse());
      }
      index++; // skip 'e'
      return list;
    }

    // Dictionary: d<keys and values>e
    if (char === 'd') {
      const dictStart = index;
      index++; // skip 'd'
      const dict = {};

      while (index < buffer.length && buffer[index] !== 101) {
        const keyStart = index;
        const key = parse();
        if (typeof key !== 'string') {
          throw new Error('Dictionary keys must be strings');
        }

        const isInfoKey = (key === 'info');
        const valStart = index;
        const val = parse();
        const valEnd = index;

        if (isInfoKey) {
          // Slice the exact raw bytes of the info dictionary
          dict._infoBuffer = buffer.subarray(valStart, valEnd);
        }

        dict[key] = val;
      }
      index++; // skip 'e'
      return dict;
    }

    // String: <len>:<string>
    if (char >= '0' && char <= '9') {
      const start = index;
      while (index < buffer.length && buffer[index] >= 48 && buffer[index] <= 57) {
        index++;
      }
      if (buffer[index] !== 58) { // 58 is ':'
        throw new Error('Expected colon in string');
      }
      const lenStr = new TextDecoder().decode(buffer.subarray(start, index));
      const len = parseInt(lenStr, 10);
      index++; // skip ':'

      const strBuffer = buffer.subarray(index, index + len);
      index += len;

      // Smart optimization: if the string is very long, it's likely the binary 'pieces' string.
      // Keep it as a raw Uint8Array to avoid performance-heavy unicode conversion.
      if (len > 1000) {
        return strBuffer;
      }

      return new TextDecoder().decode(strBuffer);
    }

    throw new Error(`Invalid bencode character: ${char} at index ${index}`);
  }

  return parse();
}

/**
 * Parses a .torrent file ArrayBuffer entirely in-browser, computing the SHA-1 infoHash.
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {Promise<{ name: string, infoHash: string, files: Array<{ name: string, path: string, length: number, index: number }> }>}
 */
export async function getTorrentInfoFromBuffer(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer);
  const decoded = decodeBencode(uint8);

  if (!decoded || !decoded.info || !decoded._infoBuffer) {
    throw new Error('Invalid torrent file: missing info dictionary');
  }

  // Compute SHA-1 hash of the raw info dictionary bytes
  const hashBuffer = await crypto.subtle.digest('SHA-1', decoded._infoBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const infoHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Format files list
  let files = [];
  const info = decoded.info;
  const name = info.name || 'Unnamed Torrent';

  if (info.files) {
    // Multi-file torrent
    files = info.files.map((file, idx) => {
      // file.path is an array of strings representing subdirectory levels
      const filePath = Array.isArray(file.path) ? file.path.join('/') : file.path || 'unknown';
      return {
        name: filePath,
        path: filePath,
        length: file.length,
        index: idx
      };
    });
  } else {
    // Single-file torrent
    files = [{
      name: name,
      path: name,
      length: info.length || 0,
      index: 0
    }];
  }

  return {
    name,
    infoHash,
    files
  };
}

/**
 * Safely parses basic details from a Magnet Link.
 * @param {string} magnetUri 
 * @returns {{ name: string, infoHash: string, files: Array<any> }}
 */
export function parseMagnetUri(magnetUri) {
  const result = {
    name: 'Torrent Stream',
    infoHash: '',
    files: []
  };

  const btihMatch = magnetUri.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (btihMatch) {
    let hash = btihMatch[1];
    if (hash.length === 32) {
      // Convert base32 to hex if base32 hash is found
      hash = base32ToHex(hash);
    }
    result.infoHash = hash.toLowerCase();
  }

  const dnMatch = magnetUri.match(/dn=([^&]+)/i);
  if (dnMatch) {
    result.name = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
  }

  return result;
}

// Simple Base32-to-Hex helper for base32 infoHashes in older magnet links
function base32ToHex(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  let hex = '';

  const cleanBase32 = base32.toUpperCase();
  for (let i = 0; i < cleanBase32.length; i++) {
    const val = alphabet.indexOf(cleanBase32[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }

  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }

  return hex;
}
