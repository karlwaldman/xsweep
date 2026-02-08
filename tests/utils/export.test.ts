import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportUsersCSV, exportUsersJSON } from "@/utils/export";
import { makeUser } from "../helpers/fixtures";

// We need to intercept Blob and the download mechanism.
// Since `new Blob()` can't be mocked with spyOn (constructor),
// we mock the entire download flow by capturing what gets passed.

let blobContent: string;
let clickSpy: ReturnType<typeof vi.fn>;
let downloadAttr: string;

function setupDownloadMock() {
  blobContent = "";
  downloadAttr = "";
  clickSpy = vi.fn();

  // Override Blob globally
  const OriginalBlob = globalThis.Blob;
  globalThis.Blob = class MockBlob {
    content: string;
    type: string;
    size: number;
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      this.content = parts?.[0]?.toString() || "";
      this.type = options?.type || "";
      this.size = this.content.length;
      blobContent = this.content;
    }
    // Satisfy instanceof checks
    slice() {
      return this as unknown as Blob;
    }
    text() {
      return Promise.resolve(this.content);
    }
    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(0));
    }
    stream() {
      return new ReadableStream();
    }
  } as any;

  // Mock URL methods to accept our MockBlob
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();

  // Mock createElement to return a fake anchor
  vi.spyOn(document, "createElement").mockReturnValue({
    href: "",
    set download(val: string) {
      downloadAttr = val;
    },
    get download() {
      return downloadAttr;
    },
    click: clickSpy,
    style: {},
  } as unknown as HTMLAnchorElement);

  vi.spyOn(document.body, "appendChild").mockReturnValue(null as any);
  vi.spyOn(document.body, "removeChild").mockReturnValue(null as any);

  return () => {
    globalThis.Blob = OriginalBlob;
  };
}

describe("exportUsersCSV", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = setupDownloadMock();
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it("generates correct CSV header row", () => {
    exportUsersCSV([makeUser()]);
    const lines = blobContent.split("\n");
    expect(lines[0]).toBe(
      "username,display_name,user_id,follower_count,following_count,tweet_count,last_tweet_date,days_inactive,status,is_mutual,verified,bio",
    );
  });

  it("escapes double quotes in displayName and bio", () => {
    const user = makeUser({
      displayName: 'She said "hello"',
      bio: 'Testing "quotes" here',
    });
    exportUsersCSV([user]);
    const lines = blobContent.split("\n");
    expect(lines[1]).toContain('"She said ""hello"""');
    expect(lines[1]).toContain('"Testing ""quotes"" here"');
  });

  it("replaces newlines in bio with spaces", () => {
    const user = makeUser({ bio: "Line one\nLine two\nLine three" });
    exportUsersCSV([user]);
    const lines = blobContent.split("\n");
    expect(lines[1]).toContain("Line one Line two Line three");
  });

  it("formats date correctly (YYYY-MM-DD)", () => {
    const user = makeUser({ lastTweetDate: "2026-01-15T12:30:00.000Z" });
    exportUsersCSV([user]);
    const lines = blobContent.split("\n");
    expect(lines[1]).toContain("2026-01-15");
  });

  it("handles null lastTweetDate as N/A", () => {
    const user = makeUser({ lastTweetDate: null, daysSinceLastTweet: null });
    exportUsersCSV([user]);
    const lines = blobContent.split("\n");
    const fields = lines[1].split(",");
    // last_tweet_date is index 6, days_inactive is index 7
    expect(fields[6]).toBe("N/A");
    expect(fields[7]).toBe("N/A");
  });

  it("creates download link and triggers click", () => {
    exportUsersCSV([makeUser()]);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(document.body.appendChild).toHaveBeenCalled();
    expect(document.body.removeChild).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("exportUsersJSON", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = setupDownloadMock();
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it("outputs valid JSON with all user fields", () => {
    const user = makeUser({ userId: "42", username: "jdoe" });
    exportUsersJSON([user]);

    const parsed = JSON.parse(blobContent);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("42");
    expect(parsed[0].username).toBe("jdoe");
    expect(parsed[0]).toHaveProperty("bio");
    expect(parsed[0]).toHaveProperty("status");
  });

  it("uses custom filename when provided", () => {
    exportUsersJSON([makeUser()], "my-export.json");
    expect(downloadAttr).toBe("my-export.json");
  });
});
