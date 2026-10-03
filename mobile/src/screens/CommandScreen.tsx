import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, Text, View } from 'react-native'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import * as Speech from 'expo-speech'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { CommandResponse } from '../lib/contracts'
import type { Warehouse } from '../hooks/useWarehouse'
import { useWakeListener, type WakePhase } from '../hooks/useWakeListener'
import { readRecording } from '../lib/recording'

/** Jak na webie: przez tyle czasu od pokazania karty działa decyzja bez prefixu („tak”). */
const VOICE_DECISION_MS = 60_000

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
  // isMeteringEnabled zasila odsiew ciszy w nasłuchu na prefix (recorder.getStatus().metering).
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })
  const recording = useAudioRecorderState(recorder)
  const proposal = response?.type === 'proposal' ? response.proposal : null
  const proposalShownAt = useRef(0)
  const prefix = data.settings.prefix || 'Magu'
  const voiceEnabled = !data.health.demo_mode && data.settings.voice_mode !== 'text'
  const wakeMode = voiceEnabled && data.settings.voice_mode === 'wake_word'

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

  async function send(command = text) {
    await run(async () => {
      const result = await api.command(command.trim())
      if (!mounted.current) return
      setResponse(result)
      if (result.type === 'proposal') proposalShownAt.current = Date.now()
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

  const wake = useWakeListener({
    enabled: wakeMode,
    prefix,
    api,
    recorder,
    active,
    cardStatus: () => {
      const pending = response?.type === 'proposal'
      return { pending, fresh: pending && Date.now() - proposalShownAt.current <= VOICE_DECISION_MS }
    },
    onEvent: event => {
      if (event.type === 'armed') setText('')
      else if (event.type === 'submit') {
        setText(event.text)
        if (!lock.current) void send(event.text)
      } else if (event.type === 'confirm') {
        if (!lock.current) void confirm()
      } else if (response?.type === 'proposal') {
        setResponse(null)
        setMessage('Kartę odrzucono głosem.')
      }
    },
    tts: data.settings.tts_enabled && !data.health.demo_mode,
  })

  const wakePhaseLabel: Record<WakePhase, string> = {
    off: 'Nasłuch wyłączony',
    starting: 'Włączam mikrofon…',
    listening: `Słucham — powiedz „${prefix}, …”`,
    armed: 'Słucham komendy…',
    transcribing: 'Rozpoznaję wypowiedź…',
    paused: 'Chwila przerwy — agent właśnie odpowiada',
    error: 'Nasłuch zatrzymany',
  }

  async function stopAndTranscribe() {
    if (timer.current) clearTimeout(timer.current)
    await run(async () => {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      const { bytes, mime, extension } = await readRecording(recorder.uri)
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
      {wakeMode ? <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <View className={`size-3 rounded-full ${wake.phase === 'listening' || wake.phase === 'starting' ? 'bg-forest' : wake.phase === 'armed' ? 'bg-amber-600' : wake.phase === 'error' ? 'bg-red-700' : 'bg-stone-400'}`} />
          <Text className="flex-1 text-sm font-medium text-ink">{wakePhaseLabel[wake.phase]}</Text>
        </View>
        <Button title={wake.on ? 'Zatrzymaj nasłuch' : `Słuchaj na „${prefix}”`}
          onPress={() => (wake.on ? wake.stop() : void wake.start())} danger={wake.on} disabled={busy && !wake.on} />
        {wake.phase === 'error' ? <View className="gap-2">
          <Message error>{wake.error}</Message>
          <Button title="Wznów nasłuch" secondary onPress={() => void wake.start()} />
        </View> : null}
        <Text className="text-sm leading-5 text-stone-500">Mów bez klikania: „{prefix}, …” i komenda — wyśle się po zakończeniu wypowiedzi. Kartę zmiany zatwierdzisz „zatwierdź”/„tak”, odrzucisz „odrzuć”/„nie”.</Text>
      </View> : <>
        <Button title={recording.isRecording ? `Zakończ nagranie · ${Math.floor(recording.durationMillis / 1000)} s` : busy ? 'Przetwarzanie…' : '● Nagraj komendę'}
          onPress={() => void (recorder.isRecording ? stopAndTranscribe() : startRecording())}
          disabled={busy || !voiceEnabled || !!proposal} danger={recording.isRecording} />
        {!voiceEnabled ? <Text className="text-sm text-stone-500">W tym trybie wpisz komendę poniżej.</Text> : null}
      </>}
      <Field label="Komenda / transkrypcja" value={text} onChangeText={setText} multiline />
      <Button title="Wyślij komendę" onPress={() => void send()} disabled={busy || (!wakeMode && recording.isRecording) || !!proposal || !text.trim()} secondary />
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
        <Button key={example} title={example} secondary disabled={busy || (!wakeMode && recording.isRecording) || !!proposal} onPress={() => setText(example)} />)}
    </Card>
  </View>
}
