import { describe, expect, test } from "bun:test";
import {
  clampMediaRange,
  isAllowedMediaUrl,
  MEDIA_CHUNK_SIZE,
} from "../src/backend/mediaProxy";

describe("isAllowedMediaUrl", () => {
  test("accepts fallback googlevideo playback URLs", () => {
    expect(
      isAllowedMediaUrl(
        "https://rr1---sn-jx25uoxu-jb3r.googlevideo.com/videoplayback?ip=1.2.3.4&fallback",
      ),
    ).toBe(true);
    expect(
      isAllowedMediaUrl(
        "https://redirector.googlevideo.com/videoplayback?id=abc&fallback",
      ),
    ).toBe(true);
  });

  test("rejects non-https, foreign hosts, non-playback paths, and unsigned URLs", () => {
    expect(
      isAllowedMediaUrl(
        "http://rr1---sn-jx25uoxu-jb3r.googlevideo.com/videoplayback?fallback",
      ),
    ).toBe(false);
    expect(isAllowedMediaUrl("https://evil.com/videoplayback?fallback")).toBe(
      false,
    );
    expect(
      isAllowedMediaUrl(
        "https://googlevideo.com.evil.com/videoplayback?fallback",
      ),
    ).toBe(false);
    expect(
      isAllowedMediaUrl(
        "https://rr1---sn-jx25uoxu-jb3r.googlevideo.com/other?fallback",
      ),
    ).toBe(false);
    expect(
      isAllowedMediaUrl(
        "https://rr1---sn-jx25uoxu-jb3r.googlevideo.com/videoplayback?ip=1.2.3.4",
      ),
    ).toBe(false);
  });
});

describe("clampMediaRange", () => {
  test("turns an open-ended or absent range into one bounded chunk", () => {
    expect(clampMediaRange(null)).toBe(`bytes=0-${MEDIA_CHUNK_SIZE - 1}`);
    expect(clampMediaRange("bytes=0-")).toBe(
      `bytes=0-${MEDIA_CHUNK_SIZE - 1}`,
    );
  });

  test("preserves bounded ranges smaller than the chunk size", () => {
    expect(clampMediaRange("bytes=0-1")).toBe("bytes=0-1");
    expect(clampMediaRange("bytes=10-20")).toBe("bytes=10-20");
  });

  test("clamps oversized ranges and resolves open-ended offsets", () => {
    expect(clampMediaRange("bytes=0-5000000")).toBe(
      `bytes=0-${MEDIA_CHUNK_SIZE - 1}`,
    );
    expect(clampMediaRange(`bytes=${MEDIA_CHUNK_SIZE}-`)).toBe(
      `bytes=${MEDIA_CHUNK_SIZE}-${MEDIA_CHUNK_SIZE * 2 - 1}`,
    );
  });

  test("rejects invalid and multi-range headers", () => {
    expect(clampMediaRange("bytes=20-10")).toBeNull();
    expect(clampMediaRange("bytes=0-1,3-4")).toBeNull();
    expect(clampMediaRange("items=0-1")).toBeNull();
  });
});
