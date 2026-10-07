# Страница в Google Play — „Моят автомобил“

Всичко нужно за страницата на приложението в Google Play. Петьо копира оттук в Play Console; Claude обновява файловете при промени в приложението.

| Файл | Какво е | Къде в Play Console |
|---|---|---|
| `listing.md` | Име, кратко и пълно описание (BG + EN), категория, контакти | Grow → Store presence → Main store listing |
| `forms.md` | Data safety, Content rating, Ads, Target audience и др. | Policy and programs → App content |
| `icon-512.png` | Икона 512×512 | Main store listing → App icon |
| `feature-graphic-bg.png` / `-en.png` | Графика 1024×500 | Main store listing → Feature graphic |
| `screenshots/bg/01–06.png` | 6 снимки 1080×1920, на български | Main store listing → Phone screenshots (bg-BG) |
| `screenshots/en/01–06.png` | Същите на английски | Translations → en-US → Phone screenshots |

**Снимките** се правят автоматично от приложението с примерни данни (Golf + Honda). Ако променим приложението — Claude ги прави наново.

**Ред на снимките:** 1 — всички срокове · 2 — напомняне · 3 — гориво · 4 — проверка на винетката по номер · 5 — медали и облекла · 6 — коли и мотори.
