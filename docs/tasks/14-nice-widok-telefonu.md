# 14: [NICE] Widok telefonu — panel push-to-talk/transkrypcja/zatwierdź

**What to build:** Responsywny widok mobilny UI: prosty panel z jednym dużym przyciskiem push-to-talk, transkrypcją, kartą zmiany i jednym przyciskiem zatwierdzenia. Zero niepotrzebnych sekcji — to widok „spacer po hali". Demo może się odbyć z telefonu (efektowne) lub z laptopa (gwarantowane) — ta karta daje opcję telefonu.

**Blocked by:** 04 (STT działa), 07 (mapa — telefon pokazuje też mini-mapę)

**Estimate:** 1 / 2

**Owner:** D (dopiero po zamknięciu wszystkich Must)

**TDD:** brak osobnego seamu — weryfikacja przez GUI-tester w rozdzielczości telefonu.

**Demo check:** otwórz aplikację na telefonie (ta sama sieć) → push-to-talk działa → karta zmiany zatwierdza jednym tapem → mini-mapa czytelna.

**Status:** ready

- [ ] działa na Androidzie/iPhonie przez przeglądarkę (ta sama sieć co backend)
- [ ] push-to-talk i zatwierdzenie jednym kciukiem
- [ ] nie psuje widoku desktop
