// scripts/diag-telegram.ts
import dotenv from "dotenv";
dotenv.config();

async function diag() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log("=== Diagnostic Telegram ===\n");
  console.log(
    `Token : ${token ? token.substring(0, 20) + "..." : "❌ MANQUANT"}`,
  );
  console.log(`Chat ID : ${chatId}\n`);

  // Test 1 : le token est-il valide ?
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const meData = await me.json();
  console.log(
    "Test 1 - getMe :",
    meData.ok ? `✅ Bot: @${meData.result.username}` : "❌ Token invalide",
  );

  // Test 2 : le bot voit-il la conversation ?
  const updates = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates`,
  );
  const updatesData = await updates.json();
  console.log(
    "Test 2 - getUpdates :",
    updatesData.result.length > 0
      ? `✅ ${updatesData.result.length} message(s)`
      : "❌ Aucun message",
  );

  // Test 3 : envoi de message
  const send = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: "Test diagnostic" }),
  });
  const sendData = await send.json();
  console.log(
    "Test 3 - sendMessage :",
    sendData.ok ? "✅ Message envoyé !" : `❌ ${sendData.description}`,
  );

  if (!sendData.ok && sendData.error_code === 404) {
    console.log(
      "\n💡 Le bot ne trouve pas ce chat. Vérifie que le token est à jour.",
    );
    console.log("   Ouvre BotFather → /mybots → ImmoSniperBot → API Token");
    console.log("   Copie le token affiché et mets-le dans .env");
  }
}

diag();
