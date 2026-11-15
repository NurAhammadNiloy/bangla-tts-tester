import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { svgToDataUrl } from "@/lib/brand";
import { DEFAULT_SETTINGS, getSettings, isValidLogoDataUrl, normalizeSettings, saveSettings, SETTINGS_STORAGE, subscribe } from "@/lib/settings";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe("normalizeSettings", () => {
  it("fills defaults for junk", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ brand: 5, defaults: { narrator: "robot", format: "1:1", music: "yes" } })).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid values", () => {
    const s = normalizeSettings({ brand: { name: " Golpo ", logoDataUrl: "data:image/png;base64,AAAA" }, defaults: { narrator: "male", captionStyle: "bubbles", format: "4:5", music: false } });
    expect(s).toEqual({ brand: { name: "Golpo", logoDataUrl: "data:image/png;base64,AAAA" }, defaults: { narrator: "male", captionStyle: "bubbles", format: "4:5", music: false } });
  });
  it("only accepts safe logos", () => {
    expect(isValidLogoDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isValidLogoDataUrl("data:image/gif;base64,AAAA")).toBe(false);
    expect(isValidLogoDataUrl("javascript:alert(1)")).toBe(false);
    expect(isValidLogoDataUrl(svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>`))).toBe(true);
    expect(isValidLogoDataUrl(svgToDataUrl(`<svg viewBox="0 0 1 1" onload="x"><circle r="1"/></svg>`))).toBe(false);
  });
});

describe("getSettings / saveSettings / subscribe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is SSR-safe without window", () => {
    expect(getSettings()).toBe(DEFAULT_SETTINGS);
    expect(saveSettings({ brand: { name: "x" } }).ok).toBe(false);
  });

  describe("in a browser", () => {
    let store: MemStorage;
    beforeEach(() => {
      store = new MemStorage();
      const target = new EventTarget();
      vi.stubGlobal("window", Object.assign(target, { localStorage: store }));
    });

    it("saves patches, returns stable snapshots and notifies subscribers", () => {
      const fn = vi.fn();
      const off = subscribe(fn);
      const r = saveSettings({ brand: { name: "Raater Golpo" }, defaults: { music: false } });
      expect(r.ok).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
      const a = getSettings();
      expect(a).toBe(getSettings());
      expect(a.brand.name).toBe("Raater Golpo");
      expect(a.defaults).toEqual({ ...DEFAULT_SETTINGS.defaults, music: false });
      saveSettings({ defaults: { narrator: "male" } });
      expect(getSettings().brand.name).toBe("Raater Golpo");
      expect(getSettings().defaults.narrator).toBe("male");
      off();
      saveSettings({ brand: { name: "" } });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("survives corrupt JSON", () => {
      store.setItem(SETTINGS_STORAGE, "{oops");
      expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    });
  });
});
