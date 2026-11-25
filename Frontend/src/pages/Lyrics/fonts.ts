import { useSyncExternalStore } from 'react'
import '@fontsource/manrope/cyrillic-800.css'
import '@fontsource/manrope/cyrillic-ext-800.css'
import '@fontsource/manrope/latin-800.css'
import '@fontsource/inter/cyrillic-800.css'
import '@fontsource/inter/cyrillic-ext-800.css'
import '@fontsource/inter/latin-800.css'
import '@fontsource/montserrat/cyrillic-800.css'
import '@fontsource/montserrat/cyrillic-ext-800.css'
import '@fontsource/montserrat/latin-800.css'
import '@fontsource/nunito/cyrillic-800.css'
import '@fontsource/nunito/cyrillic-ext-800.css'
import '@fontsource/nunito/latin-800.css'
import '@fontsource/rubik/cyrillic-800.css'
import '@fontsource/rubik/cyrillic-ext-800.css'
import '@fontsource/rubik/latin-800.css'
import '@fontsource/jost/cyrillic-800.css'
import '@fontsource/jost/latin-800.css'
import '@fontsource/raleway/cyrillic-800.css'
import '@fontsource/raleway/cyrillic-ext-800.css'
import '@fontsource/raleway/latin-800.css'
import '@fontsource/oswald/cyrillic-700.css'
import '@fontsource/oswald/cyrillic-ext-700.css'
import '@fontsource/oswald/latin-700.css'
import '@fontsource/russo-one/cyrillic-400.css'
import '@fontsource/russo-one/latin-400.css'
import '@fontsource/unbounded/cyrillic-800.css'
import '@fontsource/unbounded/cyrillic-ext-800.css'
import '@fontsource/unbounded/latin-800.css'
import '@fontsource/comfortaa/cyrillic-700.css'
import '@fontsource/comfortaa/cyrillic-ext-700.css'
import '@fontsource/comfortaa/latin-700.css'
import '@fontsource/playfair-display/cyrillic-800.css'
import '@fontsource/playfair-display/latin-800.css'
import '@fontsource/lora/cyrillic-700.css'
import '@fontsource/lora/cyrillic-ext-700.css'
import '@fontsource/lora/latin-700.css'
import '@fontsource/merriweather/cyrillic-800.css'
import '@fontsource/merriweather/cyrillic-ext-800.css'
import '@fontsource/merriweather/latin-800.css'
import '@fontsource/cormorant-garamond/cyrillic-700.css'
import '@fontsource/cormorant-garamond/cyrillic-ext-700.css'
import '@fontsource/cormorant-garamond/latin-700.css'
import '@fontsource/caveat/cyrillic-700.css'
import '@fontsource/caveat/cyrillic-ext-700.css'
import '@fontsource/caveat/latin-700.css'
import '@fontsource/marck-script/cyrillic-400.css'
import '@fontsource/marck-script/latin-400.css'
import '@fontsource/jetbrains-mono/cyrillic-800.css'
import '@fontsource/jetbrains-mono/cyrillic-ext-800.css'
import '@fontsource/jetbrains-mono/latin-800.css'
import { deleteLyricsFont, listLyricsFonts, uploadLyricsFont } from './api'
import type { CustomLyricsFont } from './types'

export const builtinFonts = {
  manrope: 'Manrope, "Segoe UI", sans-serif',
  inter: 'Inter, "Segoe UI", sans-serif',
  montserrat: 'Montserrat, "Segoe UI", sans-serif',
  nunito: 'Nunito, "Segoe UI", sans-serif',
  rubik: 'Rubik, "Segoe UI", sans-serif',
  jost: 'Jost, "Segoe UI", sans-serif',
  raleway: 'Raleway, "Segoe UI", sans-serif',
  oswald: 'Oswald, sans-serif',
  'russo-one': '"Russo One", sans-serif',
  unbounded: 'Unbounded, sans-serif',
  comfortaa: 'Comfortaa, sans-serif',
  playfair: '"Playfair Display", Georgia, serif',
  lora: 'Lora, Georgia, serif',
  merriweather: 'Merriweather, Georgia, serif',
  cormorant: '"Cormorant Garamond", Georgia, serif',
  caveat: 'Caveat, cursive',
  'marck-script': '"Marck Script", cursive',
  'jetbrains-mono': '"JetBrains Mono", Consolas, monospace',
  georgia: 'Georgia, Lora, serif',
  consolas: 'Consolas, "JetBrains Mono", monospace',
} as const

export const builtinFontLabels: Record<keyof typeof builtinFonts, string> = {
  manrope: 'Manrope',
  inter: 'Inter',
  montserrat: 'Montserrat',
  nunito: 'Nunito',
  rubik: 'Rubik',
  jost: 'Jost',
  raleway: 'Raleway',
  oswald: 'Oswald',
  'russo-one': 'Russo One',
  unbounded: 'Unbounded',
  comfortaa: 'Comfortaa',
  playfair: 'Playfair Display',
  lora: 'Lora',
  merriweather: 'Merriweather',
  cormorant: 'Cormorant Garamond',
  caveat: 'Caveat',
  'marck-script': 'Marck Script',
  'jetbrains-mono': 'JetBrains Mono',
  georgia: 'Georgia',
  consolas: 'Consolas',
}

export type CustomFontEntry = {
  key: string
  id: string
  name: string
  cssFamily: string
  stack: string
}

type CustomFontsSnapshot = {
  loaded: boolean
  fonts: CustomFontEntry[]
}

const MAX_FONT_BYTES = 16 * 1024 * 1024
const CUSTOM_PREFIX = 'custom:'

let snapshot: CustomFontsSnapshot = { loaded: false, fonts: [] }
let loadPromise: Promise<void> | null = null
const loadedFaces = new Map<string, FontFace>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(listener => listener())
}

export function customFontKey(id: string) {
  return `${CUSTOM_PREFIX}${id}`
}

export function isCustomFontKey(value: string) {
  return value.startsWith(CUSTOM_PREFIX)
}

function customCssFamily(id: string) {
  return `TesifyCustom_${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
  }
  return btoa(chunks.join(''))
}

async function registerFace(cssFamily: string, bytes: BufferSource): Promise<FontFace> {
  let face: FontFace
  try {
    face = new FontFace(cssFamily, bytes, { weight: '100 900' })
    await face.load()
  } catch {
    face = new FontFace(cssFamily, bytes)
    await face.load()
  }
  const previous = loadedFaces.get(cssFamily)
  if (previous) document.fonts.delete(previous)
  document.fonts.add(face)
  loadedFaces.set(cssFamily, face)
  return face
}

async function hydrateCustomFont(record: CustomLyricsFont): Promise<CustomFontEntry | null> {
  const cssFamily = customCssFamily(record.id)
  try {
    await registerFace(cssFamily, base64ToBytes(record.dataBase64))
    return {
      key: customFontKey(record.id),
      id: record.id,
      name: record.name,
      cssFamily,
      stack: `"${cssFamily}", Manrope, "Segoe UI", sans-serif`,
    }
  } catch {
    return null
  }
}

export function ensureCustomFontsLoaded() {
  if (loadPromise) return loadPromise
  loadPromise = listLyricsFonts()
    .then(async (records) => {
      const entries = (await Promise.all(records.map(hydrateCustomFont))).filter((entry): entry is CustomFontEntry => entry !== null)
      snapshot = { loaded: true, fonts: entries }
      notify()
    })
    .catch(() => {
      snapshot = { ...snapshot, loaded: true }
      notify()
    })
  return loadPromise
}

export async function uploadCustomLyricsFont(file: File): Promise<CustomFontEntry> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) {
    throw new Error('Выберите шрифт в формате TTF, OTF, WOFF или WOFF2.')
  }
  if (file.size <= 0 || file.size > MAX_FONT_BYTES) {
    throw new Error('Файл шрифта должен быть не больше 16 МБ.')
  }
  const buffer = await file.arrayBuffer()
  const probeFamily = `TesifyProbe_${Date.now()}`
  try {
    const probeFace = new FontFace(probeFamily, buffer)
    await probeFace.load()
  } catch {
    throw new Error('Не удалось загрузить этот файл шрифта. Проверьте, что файл не повреждён.')
  }

  const base64 = arrayBufferToBase64(buffer)
  const saved = await uploadLyricsFont(file.name, base64)
  const entry = await hydrateCustomFont(saved)
  if (!entry) {
    throw new Error('Не удалось применить загруженный шрифт.')
  }
  snapshot = {
    loaded: true,
    fonts: [...snapshot.fonts.filter(font => font.id !== entry.id), entry],
  }
  notify()
  return entry
}

export async function removeCustomLyricsFont(id: string): Promise<void> {
  await deleteLyricsFont(id)
  const cssFamily = customCssFamily(id)
  const existing = loadedFaces.get(cssFamily)
  if (existing) {
    document.fonts.delete(existing)
    loadedFaces.delete(cssFamily)
  }
  snapshot = {
    ...snapshot,
    fonts: snapshot.fonts.filter(font => font.id !== id),
  }
  notify()
}

export function resolveLyricsFontStack(fontId: string, customFonts: readonly CustomFontEntry[]): string {
  if (Object.hasOwn(builtinFonts, fontId)) {
    return builtinFonts[fontId as keyof typeof builtinFonts]
  }
  const custom = customFonts.find(font => font.key === fontId)
  return custom ? custom.stack : builtinFonts.manrope
}

export function useCustomLyricsFonts() {
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    void ensureCustomFontsLoaded()
    return () => { listeners.delete(listener) }
  }
  return useSyncExternalStore(subscribe, () => snapshot)
}
