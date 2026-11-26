// Host policy for the admin-configured iTop address (lib/itop/validateBaseUrl.ts).
// Before it, PATCH /admin/itop/settings and POST /admin/itop/test accepted any
// https:// string, so an admin session could aim the backend at
// https://10.0.0.5:8443 or https://169.254.169.254 and read the probe results.
import "../env.js";
import { describe, expect, it } from "vitest";
import { assertPublicItopUrl, isPrivateAddress, type Lookup } from "../../src/lib/itop/validateBaseUrl.js";

const resolvesTo =
  (...addresses: string[]): Lookup =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const unresolvable: Lookup = async () => {
  throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
};

describe("isPrivateAddress", () => {
  it("flags loopback, link-local, RFC1918, CGNAT, ULA and mapped forms", () => {
    for (const ip of [
      "127.0.0.1", "127.9.9.9", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10",
      "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1",
      "::ffff:10.0.0.5", "::ffff:a00:5", "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("passes public addresses", () => {
    for (const ip of ["203.0.113.7", "8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:203.0.113.7"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("decodes the IPv4 embedded in NAT64, 6to4 and IPv4-translated addresses", () => {
    for (const ip of [
      "64:ff9b::a00:1", "64:ff9b::10.0.0.1", "64:ff9b:0:0:0:0:7f00:1", "64:ff9b::169.254.169.254", "64:ff9b::c0a8:101",
      "2002:a00:1::", "2002:a00:1::1", "2002:7f00:1::1", "2002:c0a8:101:1::5", "2002:a9fe:a9fe::",
      "::ffff:0:a00:1", "::ffff:0:10.0.0.1", "::ffff:0:7f00:1", "0:0:0:0:ffff:0:c0a8:101",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      "64:ff9b::cb00:7107", "64:ff9b::203.0.113.7", "64:ff9b::808:808",
      "2002:cb00:7107::1", "2002:808:808::",
      "::ffff:0:cb00:7107", "::ffff:0:203.0.113.7",
      "64:ff9b:1::a00:1", // outside 64:ff9b::/96, not decoded
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicItopUrl", () => {
  const code = async (url: string, lookup: Lookup = resolvesTo("203.0.113.7")) =>
    assertPublicItopUrl(url, { lookup, allowPrivate: false }).then(
      () => "ok",
      (err: { code?: string }) => err.code,
    );

  it("refuses non-https, userinfo and local names before any lookup", async () => {
    const neverCalled: Lookup = async () => {
      throw new Error("lookup must not run");
    };
    expect(await code("http://itop.example.com", neverCalled)).toBe("itop_url_invalid");
    expect(await code("https://alice:pw@itop.example.com", neverCalled)).toBe("itop_url_invalid");
    expect(await code("not a url", neverCalled)).toBe("itop_url_invalid");
    for (const host of ["localhost", "itop.localhost", "itop.local", "itop.internal", "itop"]) {
      expect(await code(`https://${host}`, neverCalled), host).toBe("itop_url_private");
    }
  });

  it("refuses private address literals, also inside brackets", async () => {
    for (const host of ["127.0.0.1", "10.0.0.5:8443", "169.254.169.254", "[::1]", "[fd00::1]", "[::ffff:10.0.0.5]"]) {
      expect(await code(`https://${host}`), host).toBe("itop_url_private");
    }
  });

  it("refuses a public name that resolves to any private address, passes one that resolves publicly", async () => {
    expect(await code("https://itop.example.com", resolvesTo("10.0.0.5"))).toBe("itop_url_private");
    expect(await code("https://itop.example.com", resolvesTo("203.0.113.7", "fd00::1"))).toBe("itop_url_private");
    expect(await code("https://itop.example.com", resolvesTo("203.0.113.7", "2001:db8::1"))).toBe("ok");
    expect(await code("https://203.0.113.7/itop")).toBe("ok");
  });

  it("lets an unresolvable name through (the request itself fails later; saving while iTop is down must work)", async () => {
    expect(await code("https://itop.example.com", unresolvable)).toBe("ok");
  });

  it("ITOP_ALLOW_PRIVATE_HOSTS skips the address check but not the scheme and userinfo rules", async () => {
    await expect(assertPublicItopUrl("https://10.0.0.5", { allowPrivate: true })).resolves.toBeUndefined();
    await expect(assertPublicItopUrl("http://10.0.0.5", { allowPrivate: true })).rejects.toMatchObject({ code: "itop_url_invalid" });
  });
});
