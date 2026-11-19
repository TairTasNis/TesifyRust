import { invoke, isTauri } from '@tauri-apps/api/core'

export async function backend<T>(command: string, args: Record<string, unknown>, path: string, method = 'GET', body?: unknown): Promise<T> {
  if (isTauri()) return invoke<T>(command, args)
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error('Не удалось подключиться к библиотеке. Проверьте, что приложение запущено, и повторите попытку.')
  }
  let data: unknown
  try { data = await response.json() } catch { throw new Error('Библиотека пока недоступна. Повторите попытку через несколько секунд.') }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : 'Не удалось выполнить действие.'
    throw new Error(message)
  }
  return data as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Не удалось выполнить действие. Попробуйте ещё раз.'
}
