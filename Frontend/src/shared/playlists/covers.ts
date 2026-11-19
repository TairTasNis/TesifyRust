import { backend } from '../lib/backend'

export async function uploadCover(file: File): Promise<string> {
  const imageBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение. Выберите файл ещё раз.'))
    reader.readAsDataURL(file)
  })
  const input = { fileName: file.name, imageBase64 }
  const result = await backend<{ url: string }>('upload_playlist_cover', { input }, '/covers', 'POST', input)
  return result.url
}
