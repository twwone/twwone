let nameMap: Record<string, string> | null = null;
let pending: Promise<Record<string, string>> | null = null;

async function load(): Promise<Record<string, string>> {
  if (nameMap) return nameMap;
  if (pending)  return pending;
  pending = (async () => {
    try {
      const res = await fetch('/api/stock-names');
      if (!res.ok) return {};
      const { names } = await res.json() as { names: { code: string; name: string }[] };
      const map: Record<string, string> = {};
      for (const { code, name } of names) map[code] = name;
      nameMap = map;
      return map;
    } catch { return {}; }
    finally   { pending = null; }
  })();
  return pending;
}

export async function getNameMap(): Promise<Record<string, string>> {
  return load();
}

export function resolveName(symbol: string, map: Record<string, string>, fallback: string): string {
  const code = symbol.replace(/\.(TWO?|HK)$/i, '');
  return map[code] || fallback;
}
