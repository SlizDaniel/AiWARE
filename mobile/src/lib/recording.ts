import { Platform } from 'react-native'
import { File } from 'expo-file-system'

export type RecordingBytes = { bytes: Uint8Array; mime: string; extension: string }

/** Czyta zakończone nagranie do wysłania na /api/stt; lokalny plik usuwa po odczycie. */
export async function readRecording(uri: string | null): Promise<RecordingBytes> {
  if (!uri) throw new Error('Nie udało się zapisać nagrania. Wpisz komendę.')
  if (Platform.OS === 'web') {
    const blob = await fetch(uri).then(r => r.blob())
    const mime = blob.type.split(';')[0] || 'audio/webm'
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, extension: mime.includes('webm') ? 'webm' : 'm4a' }
  }
  const file = new File(uri)
  try { return { bytes: await file.bytes(), mime: 'audio/mp4', extension: 'm4a' } }
  finally { if (file.exists) file.delete() }
}
