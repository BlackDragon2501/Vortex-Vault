'use client'

// Vórtex Vault - gestor de contraseñas cifrado 100% local.
// La contraseña maestra nunca se guarda: se deriva una clave AES-GCM 256 con
// PBKDF2 (600k iteraciones) y todas las entradas se cifran con Web Crypto API.
// Los blobs cifrados viven en IndexedDB. Cero nube, cero cuentas, cero rastreo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ShieldCheck,
  Lock,
  Unlock,
  KeyRound,
  Plus,
  Search,
  Star,
  Copy,
  Check,
  ExternalLink,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Download,
  Upload,
  RefreshCw,
  X,
  AlertTriangle,
  Timer,
} from 'lucide-react'
import {
  VaultEntry,
  VaultMeta,
  EncryptedRecord,
  ENTRY_COLORS,
  getMeta,
  createVault,
  unlockVault,
  loadRecords,
  encryptEntry,
  decryptRecords,
  putRecord,
  deleteRecord,
  wipeVault,
  newEntry,
  generatePassword,
  passwordStrength,
  copyWithAutoClear,
} from '@/lib/vault'

type Phase = 'loading' | 'setup' | 'locked' | 'open'

function VortexLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="10" fill="#161616" />
      <circle cx="24" cy="24" r="17" fill="none" stroke="#d946ef" strokeWidth="3.5" />
      <path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke="#e879f9" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 17a7 7 0 1 0 7 7" fill="none" stroke="#e879f9" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3" fill="#e879f9" />
    </svg>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-[#2b2b31] bg-[#141416] px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-1 text-center">
        <p className="text-[11px] text-[#9b9ba4]">
          Vórtex Vault · Derechos Reservados © 2026 Vortex Company ·{' '}
          <a href="mailto:vortexmusic.soporte.app@gmail.com" className="text-[#e879f9] hover:underline">
            vortexmusic.soporte.app@gmail.com
          </a>
        </p>
        <p className="text-[11px] text-[#9b9ba4]">Cifrado AES-256 local · Cero nube · Gratis · Sin anuncios</p>
      </div>
    </footer>
  )
}

const inputCls =
  'w-full rounded-lg border border-[#2b2b31] bg-[#1e1e22] px-3 py-2 text-sm text-[#ececf1] placeholder-[#6b6b75] outline-none focus:border-[#d946ef]/70'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d946ef] px-4 py-2 text-sm font-semibold text-[#1c051f] hover:bg-[#e879f9] transition-colors disabled:opacity-40 disabled:pointer-events-none'
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-lg border border-[#2b2b31] bg-[#1e1e22] px-2.5 py-1.5 text-xs text-[#ececf1] hover:border-[#d946ef]/60 hover:text-[#e879f9] transition-colors disabled:opacity-40 disabled:pointer-events-none'

function StrengthBar({ pw }: { pw: string }) {
  const s = passwordStrength(pw)
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i <= s.score && pw ? s.color : '#2b2b31' }}
          />
        ))}
      </div>
      <span className="w-20 text-right text-[11px]" style={{ color: pw ? s.color : '#6b6b75' }}>
        {s.label}
      </span>
    </div>
  )
}

export default function VaultApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [meta, setMeta] = useState<VaultMeta | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)

  // setup
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [hint, setHint] = useState('')
  const [creating, setCreating] = useState(false)
  const [setupError, setSetupError] = useState('')

  // unlock
  const [pw, setPw] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [unlocking, setUnlocking] = useState(false)

  // open
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [query, setQuery] = useState('')
  const [onlyFav, setOnlyFav] = useState(false)
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<VaultEntry | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [gen, setGen] = useState({ length: 16, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true })
  const [flash, setFlash] = useState('')
  const [lockMin, setLockMin] = useState(5)
  const lastActivity = useRef(Date.now())
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(async () => {
      if (typeof crypto === 'undefined' || !crypto.subtle) {
        setFlash('Tu navegador no soporta Web Crypto (HTTPS requerido).')
        return
      }
      const m = await getMeta()
      setMeta(m)
      setPhase(m ? 'locked' : 'setup')
    })()
  }, [])

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 2600)
  }, [])

  const doLock = useCallback(() => {
    keyRef.current = null
    setEntries([])
    setEditor(null)
    setQuery('')
    setReveal(new Set())
    setGenOpen(false)
    setPhase('locked')
    lastActivity.current = Date.now()
  }, [])

  // ---------- bloqueo automatico ----------

  useEffect(() => {
    if (phase !== 'open') return
    const bump = () => {
      lastActivity.current = Date.now()
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > lockMin * 60_000) doLock()
    }, 10_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      window.clearInterval(timer)
    }
  }, [phase, lockMin, doLock])

  // ---------- ciclo de vida ----------

  const doCreate = async () => {
    setSetupError('')
    if (pw1.length < 8) return setSetupError('La contraseña maestra debe tener al menos 8 caracteres.')
    if (pw1 !== pw2) return setSetupError('Las contraseñas no coinciden.')
    setCreating(true)
    try {
      const m = await createVault(pw1, hint.trim())
      setMeta(m)
      const k = await unlockVault(pw1)
      if (k) {
        keyRef.current = k.key
        setEntries([])
        setPhase('open')
      }
      setPw1('')
      setPw2('')
    } catch {
      setSetupError('No se pudo crear la bóveda en este navegador.')
    } finally {
      setCreating(false)
    }
  }

  const doUnlock = async () => {
    setUnlockError('')
    setUnlocking(true)
    try {
      const k = await unlockVault(pw)
      if (!k) {
        setAttempts((a) => a + 1)
        setUnlockError('Contraseña maestra incorrecta.')
        return
      }
      keyRef.current = k.key
      const records = await loadRecords()
      const { entries: dec } = await decryptRecords(k.key, records)
      setEntries(dec)
      setPhase('open')
      setPw('')
      setAttempts(0)
      lastActivity.current = Date.now()
    } finally {
      setUnlocking(false)
    }
  }

  const doReset = async () => {
    if (!window.confirm('¿Restablecer la bóveda? Se BORRARÁN todas las entradas cifradas y la contraseña maestra actual.')) return
    if (!window.confirm('Última confirmación: esta acción es irreversible. ¿Continuar?')) return
    await wipeVault()
    setMeta(null)
    setPhase('setup')
    setUnlockError('')
    setAttempts(0)
  }

  // ---------- entradas ----------

  const persist = useCallback(
    async (entry: VaultEntry) => {
      const key = keyRef.current
      if (!key) return
      const rec = await encryptEntry(key, entry)
      await putRecord(rec)
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.id === entry.id)
        const next = idx >= 0 ? prev.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...prev]
        return next.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.updatedAt - a.updatedAt)
      })
    },
    []
  )

  const saveEntry = async () => {
    if (!editor) return
    if (!editor.title.trim()) {
      showFlash('El nombre es obligatorio')
      return
    }
    await persist({ ...editor, updatedAt: Date.now() })
    setEditor(null)
    setGenOpen(false)
    showFlash('Entrada guardada y cifrada')
  }

  const removeEntry = async (id: string) => {
    await deleteRecord(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
    showFlash('Entrada eliminada')
  }

  const toggleFav = async (entry: VaultEntry) => {
    await persist({ ...entry, favorite: !entry.favorite, updatedAt: Date.now() })
  }

  const copyField = async (text: string, what: string) => {
    try {
      await copyWithAutoClear(text, 30_000)
      showFlash(what + ' copiado · el portapapeles se vaciará en 30 s')
    } catch {
      showFlash('No se pudo copiar')
    }
  }

  // ---------- respaldo cifrado ----------

  const exportBackup = async () => {
    const m = await getMeta()
    const records = await loadRecords()
    const payload = { app: 'vortex-vault', version: 1, exportedAt: Date.now(), meta: m, records }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'vortex-vault-backup.json'
    a.click()
    URL.revokeObjectURL(a.href)
    showFlash('Copia cifrada exportada (sin datos en claro)')
  }

  const importBackup = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const key = keyRef.current
      if (!key) return
      try {
        const data = JSON.parse(String(reader.result)) as { app?: string; records?: EncryptedRecord[] }
        if (data.app !== 'vortex-vault' || !Array.isArray(data.records)) {
          showFlash('Archivo de respaldo no válido')
          return
        }
        const { entries: incoming } = await decryptRecords(key, data.records)
        if (incoming.length === 0) {
          showFlash('Ninguna entrada de ese respaldo coincide con esta contraseña maestra')
          return
        }
        let added = 0
        for (const e of incoming) {
          const cur = entries.find((x) => x.id === e.id)
          if (!cur) {
            await persist(e)
            added++
          } else if ((e.updatedAt || 0) > (cur.updatedAt || 0)) {
            await persist(e)
            added++
          }
        }
        showFlash(`Respaldo importado: ${added} entradas incorporadas`)
      } catch {
        showFlash('No se pudo leer el respaldo')
      }
    }
    reader.readAsText(file)
  }

  // ---------- filtros ----------

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (onlyFav && !e.favorite) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.url.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q)
      )
    })
  }, [entries, query, onlyFav])

  const weakCount = entries.filter((e) => passwordStrength(e.password).score <= 1).length
  const favCount = entries.filter((e) => e.favorite).length
  const cryptoOk = typeof crypto !== 'undefined' && !!crypto.subtle

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f10] text-[#ececf1]">
      {/* barra superior */}
      <header className="sticky top-0 z-20 border-b border-[#2b2b31] bg-[#141416]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <VortexLogo className="h-7 w-7 shrink-0" />
          <h1 className="truncate text-sm font-semibold">
            Vórtex <span className="text-[#e879f9]">Vault</span>
          </h1>
          {phase === 'open' && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden items-center gap-1 text-[11px] text-[#9b9ba4] sm:flex" title="Bloqueo automático por inactividad">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                <select
                  value={lockMin}
                  onChange={(e) => setLockMin(Number(e.target.value))}
                  className="rounded-md border border-[#2b2b31] bg-[#1e1e22] px-1 py-0.5 text-[11px] outline-none"
                  aria-label="Minutos de bloqueo automático"
                >
                  <option value={1}>1 min</option>
                  <option value={5}>5 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                </select>
              </span>
              <button type="button" onClick={exportBackup} className={btnGhost} title="Exportar copia cifrada">
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Copia</span>
              </button>
              <button type="button" onClick={() => importRef.current?.click()} className={btnGhost} title="Importar copia cifrada">
                <Upload className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Importar</span>
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importBackup(f)
                  e.target.value = ''
                }}
              />
              <button type="button" onClick={doLock} className={btnGhost + ' hover:border-red-500/60 hover:text-red-400'} title="Bloquear ahora">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Bloquear</span>
              </button>
            </div>
          )}
        </div>
        {flash && (
          <div className="pointer-events-none absolute inset-x-0 top-full mt-1 flex justify-center">
            <span className="rounded-full border border-[#d946ef]/40 bg-[#0f0f10] px-3 py-1 text-[11px] text-[#e879f9] shadow-lg">
              {flash}
            </span>
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        {!cryptoOk && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Tu navegador no expone Web Crypto API. Vórtex Vault necesita HTTPS (o localhost) y un navegador moderno.
          </div>
        )}

        {/* ============ FASE LOADING ============ */}
        {phase === 'loading' && (
          <div className="flex flex-1 items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-[#e879f9]" aria-label="Cargando" />
          </div>
        )}

        {/* ============ FASE SETUP ============ */}
        {phase === 'setup' && (
          <div className="mx-auto w-full max-w-md">
            <div className="mb-6 text-center">
              <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[#e879f9]" aria-hidden />
              <h2 className="text-xl font-bold">Crea tu bóveda</h2>
              <p className="mt-1 text-sm text-[#9b9ba4]">
                Elige una contraseña maestra. Todo se cifrará con ella en tu propio navegador.
              </p>
            </div>
            <div className="space-y-4 rounded-xl border border-[#2b2b31] bg-[#17171a] p-5">
              <div>
                <label className="mb-1 block text-xs text-[#9b9ba4]" htmlFor="mp1">Contraseña maestra</label>
                <input
                  id="mp1"
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  className={inputCls}
                  autoComplete="new-password"
                />
                <div className="mt-2">
                  <StrengthBar pw={pw1} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#9b9ba4]" htmlFor="mp2">Repite la contraseña</label>
                <input
                  id="mp2"
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doCreate()}
                  className={inputCls}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#9b9ba4]" htmlFor="hint">Pista opcional (se guarda sin cifrar)</label>
                <input
                  id="hint"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="Ej. la frase de siempre + año"
                  className={inputCls}
                />
              </div>
              {setupError && <p className="text-xs text-red-400">{setupError}</p>}
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                No hay recuperación posible (ni para Vortex Company): si olvidas la contraseña maestra, los datos quedan
                inaccesibles para siempre. Guárdala en un lugar muy seguro.
              </div>
              <button type="button" onClick={doCreate} disabled={creating || !cryptoOk} className={btnPrimary + ' w-full'}>
                {creating ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                {creating ? 'Derivando clave…' : 'Crear bóveda cifrada'}
              </button>
            </div>
          </div>
        )}

        {/* ============ FASE LOCKED ============ */}
        {phase === 'locked' && (
          <div className="mx-auto w-full max-w-md">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2b2b31] bg-[#17171a]">
                <Lock className="h-7 w-7 text-[#e879f9]" aria-hidden />
              </div>
              <h2 className="text-xl font-bold">Bóveda bloqueada</h2>
              <p className="mt-1 text-sm text-[#9b9ba4]">Introduce tu contraseña maestra para descifrar tus datos.</p>
              {meta?.hint && <p className="mt-2 text-xs text-[#6b6b75]">Pista: {meta.hint}</p>}
            </div>
            <div className="space-y-4 rounded-xl border border-[#2b2b31] bg-[#17171a] p-5">
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !unlocking && doUnlock()}
                placeholder="Contraseña maestra"
                className={inputCls + ' text-center'}
                autoComplete="current-password"
                autoFocus
                aria-label="Contraseña maestra"
              />
              {unlockError && <p className="text-center text-xs text-red-400">{unlockError}{attempts > 1 ? ` (intentos: ${attempts})` : ''}</p>}
              <button type="button" onClick={doUnlock} disabled={unlocking || !pw || !cryptoOk} className={btnPrimary + ' w-full'}>
                {unlocking ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Unlock className="h-4 w-4" aria-hidden />}
                {unlocking ? 'Descifrando…' : 'Desbloquear'}
              </button>
              <button type="button" onClick={doReset} className="mx-auto block text-[11px] text-[#6b6b75] underline hover:text-red-400">
                Olvidé mi contraseña: restablecer bóveda (borra todo)
              </button>
            </div>
          </div>
        )}

        {/* ============ FASE OPEN ============ */}
        {phase === 'open' && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditor(newEntry())
                  setGenOpen(false)
                }}
                className={btnPrimary}
              >
                <Plus className="h-4 w-4" aria-hidden /> Nueva entrada
              </button>
              <div className="relative ml-auto w-40 sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b6b75]" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nombre, usuario, sitio…"
                  className={inputCls + ' py-1.5 pl-8 text-xs'}
                  aria-label="Buscar entradas"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyFav(!onlyFav)}
                className={
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ' +
                  (onlyFav ? 'border-amber-400/60 text-amber-400' : 'border-[#2b2b31] text-[#9b9ba4]')
                }
              >
                <Star className="h-3.5 w-3.5" aria-hidden /> Favoritas
              </button>
            </div>

            <div className="mb-4 flex gap-2 text-[11px] text-[#9b9ba4]">
              <span className="rounded-full border border-[#2b2b31] px-2.5 py-1">{entries.length} entradas</span>
              <span className="rounded-full border border-[#2b2b31] px-2.5 py-1">{favCount} favoritas</span>
              {weakCount > 0 && (
                <span className="rounded-full border border-amber-500/50 px-2.5 py-1 text-amber-400">{weakCount} débiles</span>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#2b2b31] p-10 text-center text-sm text-[#6b6b75]">
                <ShieldCheck className="mb-2 h-8 w-8 text-[#d946ef]/60" aria-hidden />
                {entries.length === 0 ? 'Tu bóveda está lista y vacía. Añade tu primera contraseña.' : 'Sin resultados.'}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((e) => (
                  <article
                    key={e.id}
                    className="rounded-xl border border-[#2b2b31] bg-[#17171a] p-4"
                    style={{ borderLeft: `3px solid ${ENTRY_COLORS[e.color % ENTRY_COLORS.length]}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{e.title}</h3>
                        {e.url && (
                          <button
                            type="button"
                            onClick={() => window.open(e.url.startsWith('http') ? e.url : 'https://' + e.url, '_blank', 'noopener,noreferrer')}
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#38bdf8] hover:underline"
                          >
                            {e.url.replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 40)}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleFav(e)}
                        className="shrink-0 rounded-md p-1 hover:bg-[#1e1e22]"
                        title={e.favorite ? 'Quitar de favoritas' : 'Marcar favorita'}
                        aria-label={e.favorite ? 'Quitar de favoritas' : 'Marcar favorita'}
                      >
                        <Star className={'h-4 w-4 ' + (e.favorite ? 'fill-amber-400 text-amber-400' : 'text-[#6b6b75]')} aria-hidden />
                      </button>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-[#1e1e22] px-2.5 py-1.5">
                        <span className="truncate text-[#9b9ba4]">{e.username || '—'}</span>
                        <button type="button" onClick={() => copyField(e.username, 'Usuario')} className="shrink-0 text-[#6b6b75] hover:text-[#e879f9]" title="Copiar usuario" aria-label="Copiar usuario">
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-[#1e1e22] px-2.5 py-1.5">
                        <span className="truncate font-mono tracking-wider text-[#ececf1]">
                          {reveal.has(e.id) ? e.password || '—' : '••••••••••'}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setReveal((prev) => {
                                const next = new Set(prev)
                                if (next.has(e.id)) next.delete(e.id)
                                else next.add(e.id)
                                return next
                              })
                            }
                            className="text-[#6b6b75] hover:text-[#e879f9]"
                            title={reveal.has(e.id) ? 'Ocultar' : 'Mostrar'}
                            aria-label="Mostrar u ocultar contraseña"
                          >
                            {reveal.has(e.id) ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                          <button type="button" onClick={() => copyField(e.password, 'Contraseña')} className="text-[#6b6b75] hover:text-[#e879f9]" title="Copiar contraseña" aria-label="Copiar contraseña">
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      {e.label && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{ background: ENTRY_COLORS[e.color % ENTRY_COLORS.length] + '26', color: ENTRY_COLORS[e.color % ENTRY_COLORS.length] }}
                        >
                          {e.label}
                        </span>
                      )}
                      <span
                        className="ml-auto inline-flex items-center gap-1 text-[10px]"
                        style={{ color: passwordStrength(e.password).color }}
                      >
                        {passwordStrength(e.password).label}
                      </span>
                    </div>
                    {e.notes && <p className="mt-2 line-clamp-2 text-[11px] text-[#9b9ba4]">{e.notes}</p>}

                    <div className="mt-3 flex items-center gap-1 border-t border-[#2b2b31] pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditor({ ...e })
                          setGenOpen(false)
                        }}
                        className={btnGhost}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => window.confirm('¿Eliminar esta entrada de forma permanente?') && removeEntry(e.id)}
                        className={btnGhost + ' hover:border-red-500/60 hover:text-red-400'}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden /> Borrar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* ============ EDITOR DE ENTRADA ============ */}
      {phase === 'open' && editor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Editor de entrada">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2b2b31] bg-[#17171a] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{entries.some((e) => e.id === editor.id) ? 'Editar entrada' : 'Nueva entrada'}</h2>
              <button type="button" onClick={() => setEditor(null)} className="rounded-md p-1 text-[#6b6b75] hover:text-[#ececf1]" aria-label="Cerrar editor">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-3">
              <input
                value={editor.title}
                onChange={(ev) => setEditor({ ...editor, title: ev.target.value })}
                placeholder="Nombre (ej. Correo personal)"
                className={inputCls}
                aria-label="Nombre de la entrada"
              />
              <input
                value={editor.username}
                onChange={(ev) => setEditor({ ...editor, username: ev.target.value })}
                placeholder="Usuario o correo"
                className={inputCls}
                aria-label="Usuario"
                autoComplete="off"
              />
              <div>
                <div className="flex gap-1.5">
                  <input
                    type={reveal.has('editor') ? 'text' : 'password'}
                    value={editor.password}
                    onChange={(ev) => setEditor({ ...editor, password: ev.target.value })}
                    placeholder="Contraseña"
                    className={inputCls + ' font-mono'}
                    aria-label="Contraseña"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setReveal((prev) => {
                        const next = new Set(prev)
                        if (next.has('editor')) next.delete('editor')
                        else next.add('editor')
                        return next
                      })
                    }
                    className={btnGhost + ' px-2'}
                    aria-label="Mostrar u ocultar contraseña"
                  >
                    {reveal.has('editor') ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditor({ ...editor, password: generatePassword(gen) })
                      setGenOpen(true)
                    }}
                    className={btnGhost + ' px-2'}
                    title="Generar contraseña"
                    aria-label="Generar contraseña"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <div className="mt-2">
                  <StrengthBar pw={editor.password} />
                </div>
              </div>

              {genOpen && (
                <div className="rounded-lg border border-[#2b2b31] bg-[#1e1e22] p-3">
                  <div className="flex items-center justify-between text-xs text-[#9b9ba4]">
                    <span>Longitud: <strong className="text-[#ececf1]">{gen.length}</strong></span>
                    <button
                      type="button"
                      onClick={() => setEditor({ ...editor, password: generatePassword(gen) })}
                      className={btnGhost + ' py-1'}
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden /> Regenerar
                    </button>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={64}
                    value={gen.length}
                    onChange={(ev) => setGen({ ...gen, length: Number(ev.target.value) })}
                    className="mt-2 w-full accent-[#d946ef]"
                    aria-label="Longitud de la contraseña"
                  />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#9b9ba4]">
                    {([
                      ['lower', 'minúsculas a-z'],
                      ['upper', 'MAYÚSCULAS'],
                      ['digits', 'números 0-9'],
                      ['symbols', 'símbolos !@#'],
                      ['noAmbiguous', 'sin caracteres ambiguos'],
                    ] as const).map(([k, label]) => (
                      <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={gen[k]}
                          onChange={(ev) => setGen({ ...gen, [k]: ev.target.checked })}
                          className="accent-[#d946ef]"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <input
                value={editor.url}
                onChange={(ev) => setEditor({ ...editor, url: ev.target.value })}
                placeholder="Sitio web (opcional)"
                className={inputCls}
                inputMode="url"
                aria-label="Sitio web"
              />
              <textarea
                value={editor.notes}
                onChange={(ev) => setEditor({ ...editor, notes: ev.target.value })}
                placeholder="Notas seguras (opcional)"
                className={inputCls + ' min-h-[4rem] resize-y'}
                aria-label="Notas"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {ENTRY_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditor({ ...editor, color: i })}
                    aria-label={'Etiqueta color ' + (i + 1)}
                    className={
                      'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ' +
                      (editor.color === i ? 'border-white' : 'border-transparent')
                    }
                    style={{ background: c }}
                  />
                ))}
                <input
                  value={editor.label}
                  onChange={(ev) => setEditor({ ...editor, label: ev.target.value })}
                  placeholder="Etiqueta (ej. Trabajo)"
                  className={inputCls + ' w-40 flex-1'}
                  aria-label="Etiqueta"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={saveEntry} disabled={!editor.title.trim()} className={btnPrimary + ' flex-1'}>
                <Check className="h-4 w-4" aria-hidden /> Guardar cifrado
              </button>
              <button type="button" onClick={() => setEditor(null)} className={btnGhost + ' px-4'}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
