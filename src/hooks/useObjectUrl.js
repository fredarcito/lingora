import { useEffect, useState } from "react";

/**
 * A `blob:` URL for some bytes (e.g. a WAV for an `<audio>`), released when
 * the bytes change or the component goes away. `null` without bytes.
 * @param {Uint8Array | null | undefined} bytes @param {string} type MIME type.
 * @returns {string | null}
 */
export function useObjectUrl(bytes, type) {
  const [url, setUrl] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, type]);
  return url;
}
