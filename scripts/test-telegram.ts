// scripts/test-telegram.ts
import dotenv from "dotenv";
dotenv.config();

async function test() {
  console.log("Token:", process.env.TELEGRAM_BOT_TOKEN ? "✅" : "❌");
  console.log("Chat ID:", process.env.TELEGRAM_CHAT_ID);

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
  );
  const data = await res.json();
  console.log("Bot:", data.result?.username || "❌");

  const res2 = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: "Test",
      }),
    },
  );

  const result = await res2.json();
  console.log("Envoi:", result.ok ? "✅" : "❌", result.description);
}

test();
