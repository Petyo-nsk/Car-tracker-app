# Google Play — задължителни формуляри (App content)

Play Console → **Policy and programs → App content**. Отговорите по-долу са според това, което приложението реално прави (проверено в кода на 04.10.2026). Ако добавим нова функция, която праща данни навън — обнови и този файл, и `privacy.html`.

---

## 1. Privacy policy
```
https://petyo-nsk.github.io/Car-tracker-app/privacy.html
```
(после: https://parkbook.bg/privacy)

## 2. Ads — съдържа ли реклами?
**No.** (Партньорските бутони не са реклама по смисъла на Google — няма рекламна мрежа.)

## 3. App access — нужен ли е вход?
**All functionality is available without special access.**
Бележка за проверяващите (по желание, в полето „instructions“):
```
No account or login. Premium features (documents, reminders) can be unlocked with the in-app free 30-day trial button ("Start the free month") or by subscribing.
```

## 4. Content rating (въпросник IARC)
- Имейл: info@parkbook.bg
- Категория: **All Other App Types** (Utility / Productivity)
- Насилие, сексуално съдържание, език, наркотици, хазарт: **No** на всичко
- Потребителите могат ли да общуват/споделят съдържание помежду си: **No**
- Споделя ли местоположението на потребителя с други потребители: **No**
- Цифрови покупки: **Yes** (абонамент)
- Очакван резултат: PEGI 3 / Everyone

## 5. Target audience
- Възраст: **18 и повече** (приложение за шофьори)
- Привлекателно ли е за деца: **No**

## 6. News app: **No**
## 7. COVID-19 tracing: **No**
## 8. Government app: **No**
## 9. Financial features: **No** (не предлагаме застраховки, заеми или плащания — само препращаме към партньори)
## 10. Health: **No**

---

## 11. Data safety (най-важният)

### Общи въпроси
| Въпрос | Отговор |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (само HTTPS) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — по имейл info@parkbook.bg (описано в политиката, т. 10) |

### Типове данни — само тези два:

**Device or other IDs** (App info and performance → не; това е в „Device or other IDs“)
- Collected: **Yes** · Shared: **No**
- Processed ephemerally: **No**
- Required or optional: **Required** (приложението само създава анонимния номер)
- Purposes: **App functionality**, **Analytics** (броим препратените клиенти към партньори), **Fraud prevention, security, and compliance** (промо кодът да не се ползва многократно)

**Financial info → Purchase history**
- Collected: **Yes** (чрез Google Play / RevenueCat, при абонамент) · Shared: **No**
- Required or optional: **Optional** (само ако купиш абонамент)
- Purposes: **App functionality** (проверка дали абонаментът е активен)

### Какво НЕ декларираме (и защо)
- **Location** — местоположението при „Авария“ се показва само на екрана; не се праща към нас. По правилата на Google данни, които остават само на устройството, не са „събрани“.
- **Колите, датите, километрите, разходите** — пазят се само на телефона; не стигат до нас.
- **Име, имейл, телефон, ЕГН** — не ги искаме.
- **Данни за картата** — обработват се само от Google Play.

---

## 12. Разрешения на приложението (за справка — Google може да пита)
| Разрешение | Защо |
|---|---|
| INTERNET, ACCESS_NETWORK_STATE | промо кодове, партньори, абонамент |
| POST_NOTIFICATIONS | напомнянията 7 дни и 1 ден преди изтичане |
| RECEIVE_BOOT_COMPLETED, WAKE_LOCK | напомнянията да останат след рестарт на телефона |
| ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION | само бутонът „Авария“, само докато приложението е отворено |
| com.android.vending.BILLING | абонаментът през Google Play |

Точните аларми (SCHEDULE_EXACT_ALARM) са **махнати** нарочно — не са ни нужни и Google ги проверява строго.
