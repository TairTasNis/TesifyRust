import { invoke, isTauri } from '@tauri-apps/api/core'
import { version } from '../../../package.json'
import type { AppInfo } from './types'

export const defaultAppInfo: AppInfo = { name: 'Tesify', version }

export async function getAppInfo(): Promise<AppInfo> {
  return isTauri() ? invoke<AppInfo>('get_app_info') : defaultAppInfo
}
