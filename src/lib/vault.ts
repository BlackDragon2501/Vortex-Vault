// Vórtex Vault - criptografía local con Web Crypto API.
//
// Modelo de seguridad:
// - La contraseña maestra NUNCA se guarda ni sale del navegador.
// - De la maestra se deriva una clave AES-GCM 256 con PBKDF2-SHA-256
//   (600.000 iteraciones y sal aleatoria de 16 bytes).
// - Cada entrada se cifra con AES-GCM y un IV aleatorio de 12 bytes.
// - Para validar la maestra al desbloquear se usa un "verificador":
//   un texto conocido cifrado con la clave derivada.
// - Los blobs cifrados viven en IndexedDB (con respaldo en localStorage).
// - La copia de seguridad exportada también está cifrada: no contiene
//   ningún dato en claro.

export interface VaultEntry {
  id: string
  title: string
  username: string
  password: string
  url: string
  notes: string
  label: string // etiqueta de organización (texto libre)
  color: number // indice en ENTRY_COLORS
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface EncryptedRecord {
  id: string
  iv: string
  data: string
  updatedAt: number
}

export interface VaultMeta {
  version: number
  salt: string
  iterations: number
  verifier: { iv: string; data: string }
  hint: string
  createdAt: number
}

export interface EncPayload {
  iv: string
  data: string
}

const VERIFIER_PLAIN = 'vortex-vault-2026'
export const DEFAULT_ITERATIONS = 600_000

const DB_NAME = 'vortex-vault-db'
const DB_VERSION = 1
const STORE_META = 'meta'
const STORE_ENTRIES = 'entries'

const LS_META = 'vortex-vault-fallback-meta'
const LS_ENTRIES = 'vortex-vault-fallback-entries'

export const ENTRY_COLORS = [
  '#e879f9', '#38bdf8', '#34d399', '#fbbf24',
  '#f87171', '#a78bfa', '#2dd4bf', '#fb923c',
]

// ---------- utilidades base64 ----------

export function u8ToB64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}

export function b64ToU8(b64: string): Uint8Array {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

function randomBytes(n: number): Uint8Array {
  const u8 = new Uint8Array(n)
  crypto.getRandomValues(u8)
  return u8
}

// ---------- IndexedDB (con respaldo localStorage) ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) db.createObjectStore(STORE_ENTRIES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

async function idbRun<T>(store: string, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export async function getMeta(): Promise<VaultMeta | null> {
  try {
    if (idbAvailable()) {
      const v = await idbRun<VaultMeta | undefined>(STORE_META, 'readonly', (os) => os.get('meta'))
      if (v) return v
      return null
    }
  } catch {
    // cae a localStorage
  }
  try {
    const raw = localStorage.getItem(LS_META)
    return raw ? (JSON.parse(raw) as VaultMeta) : null
  } catch {
    return null
  }
}

export async function putMeta(meta: VaultMeta): Promise<void> {
  try {
    if (idbAvailable()) {
      await idbRun(STORE_META, 'readwrite', (os) => os.put(meta, 'meta'))
      return
    }
  } catch {
    // cae a localStorage
  }
  localStorage.setItem(LS_META, JSON.stringify(meta))
}

export async function loadRecords(): Promise<EncryptedRecord[]> {
  try {
    if (idbAvailable()) {
      const all = await idbRun<EncryptedRecord[]>(STORE_ENTRIES, 'readonly', (os) => os.getAll())
      if (all) return all
      return []
    }
  } catch {
    // cae a localStorage
  }
  try {
    const raw = localStorage.getItem(LS_ENTRIES)
    return raw ? (JSON.parse(raw) as EncryptedRecord[]) : []
  } catch {
    return []
  }
}

export async function putRecord(rec: EncryptedRecord): Promise<void> {
  try {
    if (idbAvailable()) {
      await idbRun(STORE_ENTRIES, 'readwrite', (os) => os.put(rec, rec.id))
      return
    }
  } catch {
    // cae a localStorage
  }
  const all = await loadRecords()
  const idx = all.findIndex((r) => r.id === rec.id)
  if (idx >= 0) all[idx] = rec
  else all.push(rec)
  localStorage.setItem(LS_ENTRIES, JSON.stringify(all))
}

export async function deleteRecord(id: string): Promise<void> {
  try {
    if (idbAvailable()) {
      await idbRun(STORE_ENTRIES, 'readwrite', (os) => os.delete(id))
      return
    }
  } catch {
    // cae a localStorage
  }
  const all = await loadRecords()
  localStorage.setItem(LS_ENTRIES, JSON.stringify(all.filter((r) => r.id !== id)))
}

export async function wipeVault(): Promise<void> {
  try {
    if (idbAvailable()) {
      await idbRun(STORE_META, 'readwrite', (os) => os.clear())
      await idbRun(STORE_ENTRIES, 'readwrite', (os) => os.clear())
    }
  } catch {
    // sigue con localStorage
  }
  localStorage.removeItem(LS_META)
  localStorage.removeItem(LS_ENTRIES)
}

// ---------- cifrado ----------

export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncPayload> {
  const iv = randomBytes(12)
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  )
  return { iv: u8ToB64(iv), data: u8ToB64(new Uint8Array(buf)) }
}

export async function decryptJson<T>(key: CryptoKey, payload: EncPayload): Promise<T> {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToU8(payload.iv) as unknown as BufferSource },
    key,
    b64ToU8(payload.data) as unknown as BufferSource
  )
  return JSON.parse(new TextDecoder().decode(buf)) as T
}

// ---------- ciclo de vida de la bóveda ----------

export async function createVault(password: string, hint: string): Promise<VaultMeta> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS)
  const verifier = await encryptJson(key, VERIFIER_PLAIN)
  const meta: VaultMeta = {
    version: 1,
    salt: u8ToB64(salt),
    iterations: DEFAULT_ITERATIONS,
    verifier,
    hint,
    createdAt: Date.now(),
  }
  await putMeta(meta)
  await wipeEntriesOnly()
  return meta
}

async function wipeEntriesOnly(): Promise<void> {
  try {
    if (idbAvailable()) await idbRun(STORE_ENTRIES, 'readwrite', (os) => os.clear())
  } catch {
    // cae a localStorage
  }
  localStorage.removeItem(LS_ENTRIES)
}

export async function unlockVault(password: string): Promise<{ key: CryptoKey; meta: VaultMeta } | null> {
  const meta = await getMeta()
  if (!meta) return null
  const key = await deriveKey(password, b64ToU8(meta.salt), meta.iterations)
  try {
    const check = await decryptJson<string>(key, meta.verifier)
    if (check !== VERIFIER_PLAIN) return null
    return { key, meta }
  } catch {
    return null
  }
}

// ---------- entradas ----------

export async function encryptEntry(key: CryptoKey, entry: VaultEntry): Promise<EncryptedRecord> {
  const payload = await encryptJson(key, entry)
  return { id: entry.id, iv: payload.iv, data: payload.data, updatedAt: entry.updatedAt }
}

export async function decryptRecords(key: CryptoKey, records: EncryptedRecord[]): Promise<{ entries: VaultEntry[]; failed: number }> {
  const entries: VaultEntry[] = []
  let failed = 0
  for (const rec of records) {
    try {
      entries.push(await decryptJson<VaultEntry>(key, rec))
    } catch {
      failed++
    }
  }
  entries.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.updatedAt - a.updatedAt)
  return { entries, failed }
}

export function newEntry(): VaultEntry {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'e-' + Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    label: '',
    color: 0,
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ---------- generador de contraseñas ----------

export interface GenOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  noAmbiguous: boolean
}

const POOLS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%&*?-_=+[]{};:,.~',
}
const AMBIGUOUS = new Set('Il1O0o`\'"|')

function randInt(max: number): number {
  // rechazo estadistico para uniformidad
  const limit = Math.floor(0xffffffff / max) * max
  const buf = new Uint32Array(1)
  let v = 0
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}

export function generatePassword(opts: GenOptions): string {
  const pick = (pool: string): string => {
    let p = pool
    if (opts.noAmbiguous) {
      const filtered = [...pool].filter((c) => !AMBIGUOUS.has(c)).join('')
      if (filtered.length > 0) p = filtered
    }
    return p[randInt(p.length)]
  }
  const pools: string[] = []
  if (opts.lower) pools.push(POOLS.lower)
  if (opts.upper) pools.push(POOLS.upper)
  if (opts.digits) pools.push(POOLS.digits)
  if (opts.symbols) pools.push(POOLS.symbols)
  if (pools.length === 0) pools.push(POOLS.lower)

  const chars: string[] = pools.slice(0, opts.length).map((p) => pick(p))
  const all = pools.join('')
  while (chars.length < opts.length) chars.push(pick(all))

  // Fisher-Yates seguro
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

// ---------- medidor de seguridad ----------

export interface Strength {
  score: number // 0..4
  label: string
  color: string
}

export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: 'Vacía', color: '#6b7280' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length
  if (classes >= 3) score++
  if (classes >= 4 && pw.length >= 12) score++
  if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|abcd|qwer|asdf)/i.test(pw)) score = Math.min(score, 1)
  score = Math.min(score, 4)
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte']
  const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981']
  return { score, label: labels[score], color: colors[score] }
}

// ---------- portapapeles con autolimpieza ----------

export async function copyWithAutoClear(text: string, clearMs = 30_000): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    window.setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {})
    }, clearMs)
  } catch {
    throw new Error('clipboard')
  }
}
