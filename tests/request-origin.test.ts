import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../lib/request-origin";
function request(origin: string | null, host = "127.0.0.1:3000", extra = {}) {
  const headers = new Headers({ host, ...extra });
  if (origin !== null) headers.set("origin", origin);
  // Reproduce Next.js's normalization: real Host is 127.0.0.1, URL is localhost.
  return { url: "http://localhost:3000/api/login", headers };
}
test("unconfigured local origin accepts the actual Host despite URL normalization", () => {
  assert.equal(isAllowedOrigin(request("http://127.0.0.1:3000")), true);
  assert.equal(
    isAllowedOrigin(request("http://localhost:3000", "localhost:3000")),
    true,
  );
  assert.equal(
    isAllowedOrigin(request("http://[::1]:3000", "[::1]:3000")),
    true,
  );
});
test("wrong website, scheme, port, missing or opaque Origin remains blocked", () => {
  for (const origin of [
    "https://elsewhere.invalid",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3000",
    "http://localhost:3000",
    "null",
    null,
    "http://127.0.0.1:3000/path",
  ]) {
    assert.equal(isAllowedOrigin(request(origin)), false, String(origin));
  }
});
test("public origin is authoritative behind a proxy and accepts a trailing slash", () => {
  assert.equal(
    isAllowedOrigin(
      request("https://news.example.com", "reader:3000"),
      "https://news.example.com/",
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      request("http://127.0.0.1:3000"),
      "https://news.example.com",
    ),
    false,
  );
  assert.equal(
    isAllowedOrigin(request("http://127.0.0.1:3000"), "invalid"),
    false,
  );
  assert.equal(isAllowedOrigin(request("http://127.0.0.1:3000"), ""), false);
});
test("forwarded headers cannot allow a foreign Origin", () => {
  assert.equal(
    isAllowedOrigin(
      request("https://elsewhere.invalid", "127.0.0.1:3000", {
        "x-forwarded-host": "elsewhere.invalid",
        "x-forwarded-proto": "https",
      }),
    ),
    false,
  );
  assert.equal(
    isAllowedOrigin(
      request("http://127.0.0.1:3000", "attacker@127.0.0.1:3000"),
    ),
    false,
  );
});
