import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'

export function Button({ title, onPress, disabled = false, secondary = false, danger = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-12 items-center justify-center rounded-2xl px-4 py-3 ${disabled ? 'opacity-40' : 'active:opacity-70'} ${danger ? 'bg-red-100' : secondary ? 'bg-accent' : 'bg-forest'}`}>
    <Text className={`text-base font-semibold ${danger ? 'text-red-800' : secondary ? 'text-forest' : 'text-white'}`}>{title}</Text>
  </Pressable>
}

export function Card({ children }: { children: ReactNode }) {
  return <View className="mb-3 gap-3 rounded-3xl border border-stone-200 bg-white p-5">{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-xl font-bold text-ink">{children}</Text>
}

export function Field({ label, value, onChangeText, multiline = false, secure = false, email = false }: {
  label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean; secure?: boolean; email?: boolean
}) {
  return <View className="gap-2"><Text className="font-medium text-ink">{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline}
      secureTextEntry={secure} autoCapitalize={email || secure ? 'none' : 'sentences'} autoCorrect={!email && !secure}
      keyboardType={email ? 'email-address' : 'default'} textAlignVertical={multiline ? 'top' : 'center'}
      className={`rounded-2xl border border-stone-300 bg-paper px-4 py-3 text-base text-ink ${multiline ? 'min-h-28' : 'min-h-12'}`} />
  </View>
}

export function Message({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <Text accessibilityRole="alert" className={`rounded-2xl p-3 text-sm leading-5 ${error ? 'bg-red-50 text-red-800' : 'bg-accent text-forest'}`}>{children}</Text>
}

export function Loading() { return <ActivityIndicator accessibilityLabel="Ładowanie" size="large" color="#315b45" className="my-8" /> }
