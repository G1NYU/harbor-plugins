/**
 * Runtime code generator for wrapping Paperback 0.9 bundles into Harbor MangaProvider plugins.
 */

export interface SourceMeta {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  language?: string;
  contentRating?: string;
  isPopular?: boolean;
  isVerified?: boolean;
}

export function generateHarborPluginBundle(sourceCode: string, meta: SourceMeta): string {
  const pluginId = meta.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const isNsfw = meta.contentRating === 'ADULT' || meta.contentRating === 'MATURE';

  // Build the self-contained wrapper
  return `// Auto-generated Harbor Manga Source Plugin from Paperback 0.9
// Source: ${meta.name} (v${meta.version})
// Upstream: inkdex/extensions (0.9/stable)

(() => {
  "use strict";

  // 1. In-memory state & interceptors for Paperback Application Bridge
  const __stateStore = new Map();
  const __interceptors = new Set();

  // Remember full series/chapter objects so later calls can pass them back, as the Paperback host does
  const __mangaCache = new Map();
  const __chapterCache = new Map();

  function __absUrl(url) {
    if (!url) return undefined;
    url = String(url).trim();
    if (!url) return undefined;
    if (/^https?:\\/\\//i.test(url)) return url;
    if (url.startsWith("//")) return "https:" + url;
    return url;
  }

  function __cleanTitle(v) {
    return (v || "").replace(/[^\\p{L}\\p{N}\\x27’]+/gu, " ").trim();
  }

  function __mapItem(item) {
    if (!item) return null;
    const id = item.mangaId || item.id;
    const title = item.title || item.primaryTitle || id;
    if (!id || !title) return null;
    return {
      id: String(id),
      title: __cleanTitle(title),
      cover: __absUrl(item.imageUrl || item.thumbnailUrl || item.cover)
    };
  }

  // 2. Mocked Paperback Application Host Bridge
  const Application = {
    arrayBufferToUTF8String(buf) {
      if (!buf) return "";
      return new TextDecoder().decode(buf);
    },
    decodeHTMLEntities(str) {
      if (!str) return "";
      return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\\d+);/g, (_, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    },
    async getDefaultUserAgent() {
      return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    },
    getState(key, def) {
      if (typeof harbor !== "undefined" && typeof harbor.getPreference === "function") {
        try {
          const val = harbor.getPreference(key, undefined);
          if (val !== undefined && val !== null && val !== "") return val;
        } catch (_) {}
      }
      return __stateStore.has(key) ? __stateStore.get(key) : def;
    },
    setState(val, key) {
      __stateStore.set(key, val);
    },
    isResourceLimited: false,
    registerInterceptor(i) {
      __interceptors.add(i);
    },
    unregisterInterceptor(i) {
      __interceptors.delete(i);
    },
    Selector(target, method) {
      return typeof target[method] === "function" ? target[method].bind(target) : () => {};
    },
    SelectorRegistry: {},
    formDidChange() {},
    sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    async scheduleRequest(req) {
      let url = req.url;
      if (typeof harbor !== "undefined" && typeof harbor.getPreference === "function") {
        try {
          const customMirror = harbor.getPreference("mirrorUrl", "");
          if (customMirror && typeof customMirror === "string" && customMirror.trim()) {
            const mirrorBase = customMirror.trim().replace(/[/]+$/, "");
            const parsedMirror = mirrorBase.startsWith("http") ? mirrorBase : "https://" + mirrorBase;
            const urlObj = new URL(url);
            const mirrorObj = new URL(parsedMirror);
            url = url.replace(urlObj.origin, mirrorObj.origin);
          }
        } catch (_) {}
      }

      const method = req.method || "GET";
      const headers = req.headers || {};
      const body = req.body;

      const res = await harbor.http(url, {
        method,
        headers,
        body,
        responseType: "text",
        timeoutMs: req.timeoutMs || 25000,
      });

      const bodyBytes = new TextEncoder().encode(res.body || "").buffer;
      const responseObj = {
        status: res.status,
        ok: res.ok,
        headers: res.headers || {},
      };

      return [responseObj, bodyBytes];
    },
  };

  // 3. Evaluate upstream Paperback source bundle
  const __executeUpstream = (Application) => {
${sourceCode}
    return typeof source !== "undefined" ? source : {};
  };

  const __sourceModule = __executeUpstream(Application);

  // Extract the scraper extension instance
  let __ext = null;
  for (const k of Object.keys(__sourceModule)) {
    const candidate = __sourceModule[k];
    if (candidate && typeof candidate.getChapters === "function") {
      __ext = candidate;
      break;
    }
  }

  if (!__ext) {
    harbor.log("Failed to locate Paperback Extension instance in module:", Object.keys(__sourceModule));
  }

  // 4. Harbor MangaProvider Adapter
  const plugin = {
    id: ${JSON.stringify(pluginId)},
    name: ${JSON.stringify(meta.name)},

    preferences: [
      {
        key: "mirrorUrl",
        label: "Mirror Domain",
        type: "text",
        default: "",
      },
      {
        key: "imageQuality",
        label: "Image Quality",
        type: "select",
        options: ["high", "medium", "low"],
        default: "high",
      },
      {
        key: "dataSaver",
        label: "Data Saver Mode",
        type: "checkbox",
        default: false,
      },
    ],

    async popular(offset, tagOrFilters) {
      if (__ext) {
        if (__ext.initialise && !this.__initDone) {
          try { await __ext.initialise(); } catch (_) {}
          this.__initDone = true;
        }

        if (!tagOrFilters) {
          const page = Math.floor(Math.max(0, offset) / 48) + 1;
          try {
            if (typeof __ext.getDiscoverSections === "function") {
              const sections = await __ext.getDiscoverSections();
              if (Array.isArray(sections) && sections.length > 0) {
                const targetSec =
                  sections.find((s) => ["hot", "recommended", "popular", "featured"].includes(String(s.id).toLowerCase())) ||
                  sections[0];
                const res = await __ext.getDiscoverSectionItems(targetSec, { page });
                const items = res?.items || (Array.isArray(res) ? res : []);
                if (items.length > 0) {
                  return items.map(__mapItem).filter(Boolean);
                }
              }
            }
          } catch (e) {
            harbor.log("getDiscoverSections error:", e);
          }
        }
      }
      return this.search("", offset, tagOrFilters);
    },

    async search(query, offset, tagOrFilters) {
      if (!__ext) return [];
      if (__ext.initialise && !this.__initDone) {
        try { await __ext.initialise(); } catch (_) {}
        this.__initDone = true;
      }

      const page = Math.floor(Math.max(0, offset) / 48) + 1;

      // 1. Resolve Sorting Options
      let sortOpts = [];
      let sortOption = { id: "default", label: "Default" };
      try {
        if (typeof __ext.getSortingOptions === "function") {
          sortOpts = (await __ext.getSortingOptions()) || [];
          if (Array.isArray(sortOpts) && sortOpts.length > 0) {
            sortOption = sortOpts[0];
          }
        }
      } catch (_) {}

      // 2. Resolve selected sort and metadata from tagOrFilters
      let metadata = undefined;
      if (typeof tagOrFilters === "string" && tagOrFilters) {
        if (tagOrFilters.startsWith("sort:")) {
          const sortId = tagOrFilters.slice(5);
          const matchedSort = sortOpts.find((s) => s.id === sortId || s.label === sortId || String(s.id).toLowerCase() === sortId.toLowerCase());
          if (matchedSort) sortOption = matchedSort;
        } else {
          const cleanTag = tagOrFilters.startsWith("genre:") ? tagOrFilters.slice(6) : tagOrFilters;
          if (typeof __ext.getSearchFilters === "function") {
            metadata = [{ id: "tags", value: { [cleanTag]: "included" } }];
          } else {
            metadata = {
              genres: [cleanTag],
              categories: { [cleanTag]: "included" },
              includedTags: [cleanTag],
              seriesStatuses: [cleanTag],
            };
          }
        }
      } else if (Array.isArray(tagOrFilters)) {
        // Structured PluginFilterGroup[]
        for (const group of tagOrFilters) {
          if (group.id === "sort" || group.name?.toLowerCase().includes("sort")) {
            const sortFilter = group.filters?.find((f) => f.type === "sort");
            if (sortFilter && sortFilter.selectedIndex != null && sortFilter.values) {
              const selectedVal = sortFilter.values[sortFilter.selectedIndex];
              const matchedSort = sortOpts.find((s) => s.label === selectedVal || s.id === selectedVal || String(s.id).toLowerCase() === String(selectedVal).toLowerCase());
              if (matchedSort) sortOption = matchedSort;
            }
          }
        }

        if (typeof __ext.getSearchFilters === "function") {
          const filterArr = [];
          for (const group of tagOrFilters) {
            if (group.id === "sort") continue;
            const groupVal = {};
            for (const f of group.filters || []) {
              if (f.type === "tri-state" && f.state && f.state !== "ignore") {
                groupVal[f.id] = f.state === "include" ? "included" : "excluded";
              } else if (f.type === "checkbox" && f.checked) {
                groupVal[f.id] = true;
              } else if (f.type === "select" && f.selectedIndex != null && f.values) {
                groupVal[f.id] = f.values[f.selectedIndex];
              }
            }
            if (Object.keys(groupVal).length > 0) {
              filterArr.push({ id: group.id, value: groupVal });
            }
          }
          if (filterArr.length > 0) metadata = filterArr;
        } else {
          const genres = [];
          const categories = {};
          for (const group of tagOrFilters) {
            if (group.id === "sort") continue;
            for (const f of group.filters || []) {
              if (f.type === "tri-state" && f.state && f.state !== "ignore") {
                if (f.state === "include") {
                  genres.push(f.id);
                  categories[f.id] = "included";
                } else if (f.state === "exclude") {
                  categories[f.id] = "excluded";
                }
              } else if (f.type === "checkbox" && f.checked) {
                genres.push(f.id);
              }
            }
          }
          if (genres.length > 0 || Object.keys(categories).length > 0) {
            metadata = { genres, categories, includedTags: genres };
          }
        }
      }

      const searchParams = { title: query || "", metadata };
      const res = await __ext.getSearchResults(searchParams, { offset, page }, sortOption);
      const items = res?.items || (Array.isArray(res) ? res : []);
      return items.map(__mapItem).filter(Boolean);
    },

    async detail(id) {
      if (!__ext) return null;
      if (__ext.initialise && !this.__initDone) {
        try { await __ext.initialise(); } catch (_) {}
        this.__initDone = true;
      }

      const res = await __ext.getMangaDetails(id);
      if (!res) return null;
      __mangaCache.set(id, res);
      const info = res.mangaInfo || res;
      const primaryTitle = info.primaryTitle || info.title || id;
      const altTitles = info.secondaryTitles || (info.altTitle ? [info.altTitle] : []);

      return {
        id,
        title: __cleanTitle(primaryTitle),
        altTitle: altTitles[0] || undefined,
        cover: __absUrl(info.thumbnailUrl || info.imageUrl || info.cover),
        description: info.synopsis || info.description || undefined,
        status: info.status || undefined,
        author: info.author || undefined,
        contentRating: info.contentRating || undefined,
      };
    },

    async chapters(id) {
      if (!__ext) return [];
      if (__ext.initialise && !this.__initDone) {
        try { await __ext.initialise(); } catch (_) {}
        this.__initDone = true;
      }

      const __cached = __mangaCache.get(id);
      let __smUsed = __cached ? Object.assign({ mangaId: id }, __cached) : { mangaId: id };
      let res;
      try {
        res = await __ext.getChapters(__smUsed);
      } catch (e) {
        if (__cached) throw e;
        const det = await __ext.getMangaDetails(id);
        if (!det) throw e;
        __mangaCache.set(id, det);
        __smUsed = Object.assign({ mangaId: id }, det);
        res = await __ext.getChapters(__smUsed);
      }
      const list = Array.isArray(res) ? res : (res?.chapters || []);
      return list
        .map((c, index) => {
          const chapterId = c.chapterId || c.id || String(index);
          const compositeId = \`\${id}::\${chapterId}\`;
          __chapterCache.set(compositeId, { raw: c, sm: __smUsed });
          return {
            id: compositeId,
            chapter: c.chapNum != null ? String(c.chapNum) : (c.chapter != null ? String(c.chapter) : null),
            title: c.title || undefined,
            volume: c.volume != null ? String(c.volume) : null,
            pages: 0,
            language: c.langCode || "en",
            group: c.group || c.version || undefined,
            publishAt: c.publishDate ? new Date(c.publishDate).toISOString() : undefined,
          };
        })
        .filter((c) => Boolean(c.id));
    },

    async pageUrls(compositeId) {
      if (!__ext) return [];
      if (__ext.initialise && !this.__initDone) {
        try { await __ext.initialise(); } catch (_) {}
        this.__initDone = true;
      }

      let mangaId = "";
      let chapterId = compositeId;
      if (compositeId.includes("::")) {
        const parts = compositeId.split("::");
        mangaId = parts[0];
        chapterId = parts.slice(1).join("::");
      }

      const __cc = __chapterCache.get(compositeId);
      const __sm = (__cc && __cc.sm) || (__mangaCache.get(mangaId) ? Object.assign({ mangaId }, __mangaCache.get(mangaId)) : { mangaId });
      const __chapterArg = Object.assign({}, __cc ? __cc.raw : {}, { sourceManga: __sm, chapterId });

      let res;
      try {
        res = await __ext.getChapterDetails(__chapterArg);
      } catch (e) {
        if (__cc) throw e;
        const det = __mangaCache.get(mangaId) || (await __ext.getMangaDetails(mangaId));
        if (!det) throw e;
        __mangaCache.set(mangaId, det);
        const sm2 = Object.assign({ mangaId }, det);
        const chs = await __ext.getChapters(sm2);
        const arr = Array.isArray(chs) ? chs : ((chs && chs.chapters) || []);
        const found = arr.find((x) => String(x.chapterId || x.id) === chapterId);
        res = await __ext.getChapterDetails(Object.assign({}, found || {}, { sourceManga: sm2, chapterId }));
      }

      const pages = res?.pages || res?.images || res?.imageUrls || (Array.isArray(res) ? res : []);
      return pages.map(__absUrl).filter(Boolean);
    },

    async getFilters() {
      if (!__ext) return [];
      if (__ext.initialise && !this.__initDone) {
        try { await __ext.initialise(); } catch (_) {}
        this.__initDone = true;
      }

      const groups = [];

      // 1. Sorting options group
      if (typeof __ext.getSortingOptions === "function") {
        try {
          const sortOpts = await __ext.getSortingOptions();
          if (Array.isArray(sortOpts) && sortOpts.length > 0) {
            groups.push({
              id: "sort",
              name: "Sort By",
              filters: [
                {
                  type: "sort",
                  id: "order",
                  name: "Order",
                  values: sortOpts.map((s) => s.label || s.id),
                  selectedIndex: 0,
                  ascending: false,
                },
              ],
            });
          }
        } catch (_) {}
      }

      // 2. Search tags / filters groups
      if (typeof __ext.getSearchTags === "function") {
        try {
          const tagGroups = await __ext.getSearchTags();
          if (Array.isArray(tagGroups)) {
            for (const tg of tagGroups) {
              if (tg.tags && tg.tags.length > 0) {
                groups.push({
                  id: tg.id || "tags",
                  name: tg.title || tg.id || "Tags",
                  filters: tg.tags.map((t) => ({
                    type: "tri-state",
                    id: t.id,
                    name: t.title || t.id,
                    state: "ignore",
                  })),
                });
              }
            }
          }
        } catch (_) {}
      } else if (typeof __ext.getSearchFilters === "function") {
        try {
          const filters = await __ext.getSearchFilters();
          if (Array.isArray(filters)) {
            for (const f of filters) {
              if (f.options && Array.isArray(f.options) && f.options.length > 0) {
                groups.push({
                  id: f.id,
                  name: f.title || f.id,
                  filters: f.options.map((o) => ({
                    type: "tri-state",
                    id: o.id,
                    name: o.title || o.id,
                    state: "ignore",
                  })),
                });
              }
            }
          }
        } catch (_) {}
      }

      return groups;
    },

    async tags() {
      const filters = await this.getFilters();
      const tagList = [];

      for (const group of filters) {
        if (group.id === "sort") {
          const sortFilter = group.filters?.find((f) => f.type === "sort");
          if (sortFilter && sortFilter.values) {
            for (const val of sortFilter.values) {
              tagList.push({ id: "sort:" + val, name: val, group: "Sort" });
            }
          }
        } else {
          for (const f of group.filters || []) {
            tagList.push({ id: "genre:" + f.id, name: f.name, group: group.name });
          }
        }
      }

      // Fallback to legacy getGenres if available and empty
      if (tagList.length === 0 && __ext && typeof __ext.getGenres === "function") {
        try {
          const genres = await __ext.getGenres();
          if (Array.isArray(genres)) {
            return genres
              .map((g) => ({
                id: g.id || g.title,
                name: g.title || g.id,
                group: "Genre",
              }))
              .filter((t) => t.id && t.name);
          }
        } catch (_) {}
      }

      return tagList;
    },
  };

  // Register with Harbor
  if (typeof harbor !== "undefined" && harbor.register) {
    try {
      harbor.register(plugin);
    } catch (_) {}
  }
})();
`;
}
