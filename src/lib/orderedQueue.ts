/**
 * Kolejka zachowująca kolejność: zadania (np. transkrypcje fraz) mogą trwać równolegle
 * i kończyć się w dowolnej kolejności, ale wyniki trafiają do `deliver` w kolejności zgłoszenia.
 * `cancel()` porzuca wszystkie jeszcze niedostarczone wyniki (np. po wyłączeniu nasłuchu).
 */
export function createOrderedQueue<T>() {
  let tail: Promise<void> = Promise.resolve()
  let generation = 0
  return {
    push(task: Promise<T>, deliver: (value: T) => void): Promise<void> {
      const pushedIn = generation
      tail = tail
        .then(() => task)
        .then(
          (value) => {
            if (pushedIn === generation) deliver(value)
          },
          () => {
            /* nieudane zadanie nie blokuje kolejnych */
          },
        )
      return tail
    },
    /** Porzuca niedostarczone wyniki; nowe zadania nie czekają na stare (np. zawieszone żądanie). */
    cancel() {
      generation++
      tail = Promise.resolve()
    },
  }
}
