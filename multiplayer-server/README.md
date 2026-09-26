# Motri Multiplayer Prototype

هذا مجلد خادم النسخة التجريبية للـ Multiplayer.

## الفكرة

- Cloudflare Worker يستقبل WebSocket.
- كل غرفة تتحول إلى Durable Object مستقل.
- الحد الحالي: 6 لاعبين لكل غرفة.
- السيارة المحلية تحتفظ بفيزياء Rapier على جهاز اللاعب.
- السيارات البعيدة تستقبل Transform/Velocity بمعدل 10Hz ويطبق العميل interpolation.
- لا توجد تصادمات بين سيارات اللاعبين في هذه النسخة الأولى.

## تشغيل الخادم

```bash
cd multiplayer-server
npm install
npx wrangler login
npm run deploy
```

بعد النشر انسخ رابط Worker، مثال:

```text
https://motri-multiplayer.<account>.workers.dev
```

ثم حوّله إلى WebSocket وضعه في ملف البيئة الخاص باللعبة:

```env
VITE_SERVER_URL=wss://motri-multiplayer.<account>.workers.dev
VITE_MULTIPLAYER_ROOM=public
```

يمكن تغيير الغرفة من الرابط بدون تعديل البيئة:

```text
?room=test1
```

## اختبار أولي

افتح اللعبة على جهازين بنفس الغرفة. يجب أن تظهر سيارة الجهاز الآخر وتتحرك بسلاسة. إذا ثبتت هذه المرحلة نضيف اختيار السيارة، الأسماء، الدعوات، السباقات ثم التصادمات.
