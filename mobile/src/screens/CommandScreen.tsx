import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, Text, View } from 'react-native'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { File } from 'expo-file-system'
import * as Speech from 'expo-speech'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { CommandResponse } from '../lib/contracts'
import type { Warehouse } from '../hooks/useWarehouse'

export function CommandScreen({ active, api, data, reload, onLocation }: {
  active: boolean; api: Api; data: Warehouse; reload: () => Promise<void>; onLocation: (name: string, location: string) => void
}) {
  const [text, setText] = useState('')
  const [response, setResponse] = useState<CommandResponse | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recording = useAudioRecorderState(recorder)
  const proposal = response?.type === 'proposal' ? response.proposal : null
  const voiceEnabled = !data.health.demo_mode && data.settings.voice_mode !== 'text'

  useEffect(() => {
    mounted.current = true
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && recorder.isRecording) {
        if (timer.current) clearTimeout(timer.current)
        void recorder.stop().catch(() => undefined).finally(() => setAudioModeAsync({ allowsRecording: false }).catch(() => undefined))
      }
    })
    return () => {
      mounted.current = false
      subscription.remove()
      if (timer.current) clearTimeout(timer.current)
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
      void Speech.stop()
    }
  }, [recorder])

  useEffect(() => {
    if (!active && recorder.isRecording) {
      if (timer.current) clearTimeout(timer.current)
      void recorder.stop().catch(() => undefined).finally(() => setAudioModeAsync({ allowsRecording: false }).catch(() => undefined))
      setMessage('Nagranie przerwano po opuszczeniu panelu komend.')
    }
  }, [active, recorder])

  function say(value: string) {
    if (data.settings.tts_enabled && !data.health.demo_mode) {
      Speech.stop(); Speech.speak(value.slice(0, 220), { language: 'pl-PL' })
    }
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Operacja nie powiodła się.') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }

  async function send() {
    if (recorder.isRecording) return
    await run(async () => {
      const result = await api.command(text.trim())
      if (!mounted.current) return
      setResponse(result)
      if (result.type === 'answer') {
        say(result.text)
        const item = result.tool === 'get_location' ? result.data : result.data.item
        if (item && typeof item === 'object') {
          const value = item as Record<string, unknown>
          const name = value.item_name ?? value.name
          if (typeof name === 'string' && typeof value.location === 'string') onLocation(name, value.location)
        }
      }
    })
  }

  async function confirm() {
    if (!proposal) return
    await run(async () => {
      const result = await api.confirm(proposal.id)
      if (mounted.current) {
        setResponse(null); setText('')
        const msg = result.applied ? 'Zapisano zmianę. Historia i stany zostały zaktualizowane.' : 'Ta karta została już zatwierdzona.'
        setMessage(result.reorder_draft ? `${msg} Szkic zamówienia znajdziesz w kolejce.` : msg)
        say(msg)
      }
      await reload()
    })
  }

  async function stopAndTranscribe() {
    if (timer.current) clearTimeout(timer.current)
    await run(async () => {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      if (!recorder.uri) throw new Error('Nie udało się zapisać nagrania. Wpisz komendę.')
      let bytes: Uint8Array
      let mime = 'audio/mp4'
      let extension = 'm4a'
      if (Platform.OS === 'web') {
        const blob = await fetch(recorder.uri).then(r => r.blob())
        bytes = new Uint8Array(await blob.arrayBuffer())
        mime = blob.type.split(';')[0] || 'audio/webm'; extension = mime.includes('webm') ? 'webm' : 'm4a'
      } else {
        const file = new File(recorder.uri)
        try { bytes = await file.bytes() } finally { if (file.exists) file.delete() }
      }
      const transcription = await api.transcribe(bytes, mime, extension)
      if (mounted.current) { setText(transcription); setMessage('Sprawdź transkrypcję i wyślij komendę.') }
    })
  }

  async function startRecording() {
    if (recorder.isRecording) return
    await run(async () => {
      await Speech.stop()
      const permission = await AudioModule.requestRecordingPermissionsAsync()
      if (!permission.granted) throw new Error('Brak dostępu do mikrofonu. Włącz go w ustawieniach telefonu lub wpisz komendę.')
      if (!mounted.current || !activeRef.current) return
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        if (!mounted.current || !activeRef.current || (Platform.OS !== 'web' && AppState.currentState !== 'active')) {
          await setAudioModeAsync({ allowsRecording: false }); return
        }
        recorder.record()
        timer.current = setTimeout(() => void stopAndTranscribe(), 45_000)
      } catch (error) {
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
        throw error
      }
    })
  }

  return <View className="gap-2">
    <Card><Text className="text-xs font-bold uppercase tracking-widest text-forest">ASYSTENT NA HALI</Text>
      <Title>Co robimy w magazynie?</Title>
      <Text className="leading-6 text-stone-600">Powiedz, co wziąłeś, zapytaj o lokalizację lub zapamiętaj procedurę. Zapis zawsze zatwierdzasz.</Text>
      <Button title={recording.isRecording ? `Zakończ nagranie · ${Math.floor(recording.durationMillis / 1000)} s` : busy ? 'Przetwarzanie…' : '● Nagraj komendę'}
        onPress={() => void (recorder.isRecording ? stopAndTranscribe() : startRecording())}
        disabled={busy || !voiceEnabled || !!proposal} danger={recording.isRecording} />
      {!voiceEnabled ? <Text className="text-sm text-stone-500">W tym trybie wpisz komendę poniżej.</Text> : null}
      <Field label="Komenda / transkrypcja" value={text} onChangeText={setText} multiline />
      <Button title="Wyślij komendę" onPress={() => void send()} disabled={busy || recording.isRecording || !!proposal || !text.trim()} secondary />
    </Card>
    {error ? <Message error>{error}</Message> : null}
    {message ? <Message>{message}</Message> : null}
    {response?.warning ? <Message>{response.warning}</Message> : null}
    {proposal ? <Card><Text className="text-xs font-bold text-forest">DO ZATWIERDZENIA</Text><Title>{proposal.summary}</Title>
      {proposal.before !== undefined && proposal.after !== undefined ? <Text className="text-3xl font-bold text-ink">{proposal.before} → {proposal.after} {proposal.unit}</Text> : null}
      <Text className="text-stone-600">Zmiana zostanie zapisana dopiero po zatwierdzeniu.</Text>
      <Button title={busy ? 'Zapisywanie…' : 'Zatwierdź zmianę'} onPress={() => void confirm()} disabled={busy} />
      <Button title="Odrzuć kartę" secondary onPress={() => setResponse(null)} disabled={busy} />
    </Card> : response && response.type !== 'proposal' ? <Card><Title>Odpowiedź Magu</Title><Text className="text-base leading-6 text-ink">{response.type === 'clarify' ? response.message : response.text}</Text></Card> : null}
    <Card><Title>Spróbuj powiedzieć</Title>
      {['wzięliśmy paletę kartonów', 'gdzie leży szkło?', 'jak pakujemy szkło?'].map(example =>
        <Button key={example} title={example} secondary disabled={busy || recording.isRecording || !!proposal} onPress={() => setText(example)} />)}
    </Card>
  </View>
}
